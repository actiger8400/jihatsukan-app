require('dotenv').config();
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const app = express();
const PORT = process.env.PORT || 3000;

// multer: メモリストレージ（ファイルをディスクに保存しない）
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB上限
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('PDFファイルのみアップロード可能です。'));
        }
    }
});

app.use(express.json());
app.use(express.static('public'));

// Gemini API プロキシエンドポイント
app.post('/api/generate', upload.single('pdfFile'), async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'サーバーにAPIキーが設定されていません。' });
    }

    const {
        childName, childAge, childProfile, childStatus,
        assessment, familyWishes, longTermGoal, shortTermGoal,
        classroomName, classroomPolicy
    } = req.body;

    if (!childStatus) {
        return res.status(400).json({ error: '日々の様子・気になる特性は必須です。' });
    }

    // PDF解析
    let pastPlanText = '';
    if (req.file) {
        try {
            const pdfData = await pdfParse(req.file.buffer);
            pastPlanText = pdfData.text.slice(0, 8000); // トークン節約のため8000文字まで
        } catch (err) {
            console.error('PDF parse error:', err);
            return res.status(400).json({ error: 'PDFの読み取りに失敗しました。別のファイルをお試しください。' });
        }
    }

    const model = 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // プロンプト組み立て
    const prompt = buildPrompt({
        childName, childAge, childProfile, childStatus,
        assessment, familyWishes, longTermGoal, shortTermGoal,
        classroomName, classroomPolicy, pastPlanText
    });

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

// multerエラーハンドリング
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'ファイルサイズは10MB以下にしてください。' });
        }
        return res.status(400).json({ error: 'ファイルアップロードエラー: ' + err.message });
    }
    if (err) {
        return res.status(400).json({ error: err.message });
    }
    next();
});

// プロンプト構築関数
function buildPrompt(data) {
    const sections = [];

    sections.push(`あなたは経験豊かで、保護者やスタッフから非常に信頼されている児童発達支援管理責任者（児発管）です。
令和6年度の放課後等デイサービス事業のガイドラインに沿った、5領域（健康・生活、運動・感覚、認知・行動、言語・コミュニケーション、人間関係・社会性）に基づく個別支援計画を作成してください。

文章は、保護者や現場の施設スタッフが読んでも分かりやすく、温かみがありながら専門的な説得力を持つトーン（丁寧な日本語）で記述してください。`);

    // 過去の計画書
    if (data.pastPlanText) {
        sections.push(`【過去の個別支援計画書の内容】
以下は前回の支援計画書から抽出したテキストです。今回の計画は、この内容との整合性・連続性を保ちつつ、新たな情報を反映して作成してください。前回からの成長や変化があれば言及してください。
---
${data.pastPlanText}
---`);
    }

    // 教室情報
    if (data.classroomName || data.classroomPolicy) {
        sections.push(`【教室情報】
教室名: ${data.classroomName || '未記入'}
教室の特徴・方針:
${data.classroomPolicy || '未記入'}
※上記の教室の方針や特徴を支援内容に反映してください。`);
    }

    // 利用者情報
    sections.push(`【利用者情報】
利用者名: ${data.childName || '未記入'}
年齢・学年: ${data.childAge || '未記入'}
基本情報（診断名、発達段階など）: ${data.childProfile || '未記入'}
日々の様子・気になる特性・興味・ニーズ:
${data.childStatus}`);

    // アセスメント
    if (data.assessment) {
        sections.push(`【アセスメント（現在の状況評価）】
${data.assessment}`);
    }

    // 家族の意向・目標
    if (data.familyWishes || data.longTermGoal || data.shortTermGoal) {
        sections.push(`【家族の意向・目標設定】
家族の意向・希望: ${data.familyWishes || '未記入'}
長期目標（1年間）: ${data.longTermGoal || '未記入'}
短期目標（6ヶ月）: ${data.shortTermGoal || '未記入'}`);
    }

    // 出力フォーマット
    sections.push(`【出力フォーマット要件】
以下の構成（Markdown形式）で出力してください。5領域はそれぞれ独立したセクションとして詳細に記述してください。

## 1. 総合所見
利用者の全体像と総合的な援助の方針を記述。

## 2. 5領域別 支援計画

### 2-1. 健康・生活
- **達成目標**:
- **現状と課題**:
- **具体的な支援内容**（小集団で行える療育内容を5つ）:
- **評価基準・方法**:

### 2-2. 運動・感覚
- **達成目標**:
- **現状と課題**:
- **具体的な支援内容**（小集団で行える療育内容を5つ）:
- **評価基準・方法**:

### 2-3. 認知・行動
- **達成目標**:
- **現状と課題**:
- **具体的な支援内容**（小集団で行える療育内容を5つ）:
- **評価基準・方法**:

### 2-4. 言語・コミュニケーション
- **達成目標**:
- **現状と課題**:
- **具体的な支援内容**（小集団で行える療育内容を5つ）:
- **評価基準・方法**:

### 2-5. 人間関係・社会性
- **達成目標**:
- **現状と課題**:
- **具体的な支援内容**（小集団で行える療育内容を5つ）:
- **評価基準・方法**:

## 3. 家族支援プログラム
- **達成目標**: ご家族や関係機関などと連携し情報共有することで集団・個別のサポートを受けることができる
- **支援内容と留意事項**: 必要に応じて相談支援を行います（家族支援・関係機関連携・事業所間連携での訪問支援・個別支援、その際加算算定いたします）
- **支援計画における家族の役割**: 具体的に記述

## 4. 移行支援プログラム
- **新しい環境への適応を助ける**: 具体的な支援内容を記述

## 5. PDCAサイクル
- **Plan（計画）**:
- **Do（実施）**:
- **Check（評価）**:
- **Action（改善）**:

## 6. 保護者・スタッフへの伝え方
温かみのある言葉で、保護者やスタッフに伝える際のポイントを記述。

## 7. 補足（専門用語の解説）
使用した専門用語があれば解説。

それでは、プロの児発管の視点から出力をお願いします。`);

    return sections.join('\n\n');
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
