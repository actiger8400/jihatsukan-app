require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Gemini API プロキシエンドポイント
app.post('/api/generate', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'サーバーにAPIキーが設定されていません。' });
    }

    const { profile, status } = req.body;
    if (!status) {
        return res.status(400).json({ error: '日々の様子・気になる特性は必須です。' });
    }

    const model = 'gemini-1.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const prompt = `
あなたは経験豊かで、保護者やスタッフから非常に信頼されている児童発達支援管理責任者（じはつかん児発管）です。
以下の児童の情報（基本情報、日々の様子・特性）をもとに、個別支援計画書の作成に役立つ詳細な分析と提案を作成してください。

文章は、保護者や現場の施設スタッフが読んでも分かりやすく、温かみがありながら、専門的な説得力を持つトーン（丁寧な日本語）で記述してください。

【対象児童の情報】
基本情報（年齢、診断名など）: ${profile || '特になし'}
日々の様子・気になる特性:
${status}

【出力フォーマット要件】
以下の見出し（Markdown形式）を必ず含めて記述してください。
1. 所見
2. 【現状分析】
3. 【具体的なアプローチ】
4. 【保護者スタッフへの伝え方】
5. 【長期展望】
6. 補足（専門用語を使用した場合の解説）

それでは、プロの視点から出力をお願いします。
`;

    const requestBody = {
        contents: [{ parts: [{ text: prompt }] }]
    };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Gemini API Error:', data);
            return res.status(response.status).json({
                error: data.error?.message || `Gemini API Error: ${response.status}`
            });
        }

        if (data.candidates && data.candidates[0].content) {
            const text = data.candidates[0].content.parts[0].text;
            res.json({ result: text });
        } else {
            res.status(500).json({ error: '予期しないレスポンス形式です。' });
        }
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
