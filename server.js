require('dotenv').config();
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const app = express();
const PORT = process.env.PORT || 3000;

// multer: メモリストレージ（ファイルをディスクに保存しない）
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('PDFファイルのみアップロード可能です。'));
        }
    }
});

// 複数PDFフィールド定義
const uploadFields = upload.fields([
    { name: 'pdfFile', maxCount: 1 },         // 過去の個別支援計画書
    { name: 'assessmentPdf', maxCount: 1 }     // アセスメントシート
]);

app.use(express.json());
app.use(express.static('public'));

// PDFからテキスト抽出
async function extractPdfText(fileBuffer, maxLength) {
    const pdfData = await pdfParse(fileBuffer);
    return pdfData.text.slice(0, maxLength);
}

// 個別支援計画書PDFから利用者情報を抽出するエンドポイント
app.post('/api/extract-pdf', upload.single('pdfFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'PDFファイルが送信されていません。' });
    }

    try {
        const pdfData = await pdfParse(req.file.buffer);
        const text = pdfData.text;

        // テキストからフィールドを推定抽出
        const extracted = extractFieldsFromPdf(text);
        extracted.rawText = text.slice(0, 8000);

        res.json(extracted);
    } catch (err) {
        console.error('PDF extract error:', err);
        res.status(400).json({ error: 'PDFの読み取りに失敗しました。' });
    }
});

// PDFテキストから各フィールドを推定抽出
function extractFieldsFromPdf(text) {
    const result = {
        childName: '',
        childAge: '',
        childProfile: '',
        familyWishes: '',
        longTermGoal: '',
        shortTermGoal: ''
    };

    // 氏名の抽出パターン
    const namePatterns = [
        /(?:氏\s*名|利用者名|児童名|お名前|名前)\s*[:：\s]\s*(.+)/,
        /(?:フリガナ|ふりがな).+\n\s*(.+)/
    ];
    for (const pattern of namePatterns) {
        const match = text.match(pattern);
        if (match) {
            const name = match[1].trim().split(/[\s\n\t]/)[0].replace(/[\(（].+[\)）]/, '').trim();
            if (name && name.length <= 20) {
                result.childName = name;
                break;
            }
        }
    }

    // 年齢の抽出
    const agePatterns = [
        /(?:年齢|生年月日|年\s*齢)\s*[:：\s]\s*(.+)/,
        /(\d{1,2})\s*歳/
    ];
    for (const pattern of agePatterns) {
        const match = text.match(pattern);
        if (match) {
            result.childAge = match[1].trim().slice(0, 30);
            break;
        }
    }

    // 診断名
    const diagPatterns = [
        /(?:診断名|障害名|障がい名|疾患名)\s*[:：\s]\s*(.+)/
    ];
    for (const pattern of diagPatterns) {
        const match = text.match(pattern);
        if (match) {
            result.childProfile = match[1].trim().slice(0, 100);
            break;
        }
    }

    // 家族の意向
    const familyPatterns = [
        /(?:保護者.*(?:意向|希望|ニーズ|要望)|家族.*(?:意向|希望|ニーズ|要望)|ご家族.*(?:意向|希望))\s*[:：\s]\s*([\s\S]{1,300}?)(?=\n(?:[A-Z\u3000-\u9FFF]|$|\d+\.))/
    ];
    for (const pattern of familyPatterns) {
        const match = text.match(pattern);
        if (match) {
            result.familyWishes = match[1].trim().slice(0, 300);
            break;
        }
    }

    // 長期目標
    const longGoalPatterns = [
        /(?:長期目標|長期的な目標)\s*[:：\s]\s*([\s\S]{1,300}?)(?=\n(?:短期|[A-Z\u3000-\u9FFF]|\d+\.))/
    ];
    for (const pattern of longGoalPatterns) {
        const match = text.match(pattern);
        if (match) {
            result.longTermGoal = match[1].trim().slice(0, 300);
            break;
        }
    }

    // 短期目標
    const shortGoalPatterns = [
        /(?:短期目標|短期的な目標)\s*[:：\s]\s*([\s\S]{1,300}?)(?=\n(?:支援|具体|[A-Z\u3000-\u9FFF]|\d+\.))/
    ];
    for (const pattern of shortGoalPatterns) {
        const match = text.match(pattern);
        if (match) {
            result.shortTermGoal = match[1].trim().slice(0, 300);
            break;
        }
    }

    return result;
}

// 支援計画生成エンドポイント
app.post('/api/generate', uploadFields, async (req, res) => {
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

    // 過去の計画書PDF解析
    let pastPlanText = '';
    if (req.files && req.files['pdfFile'] && req.files['pdfFile'][0]) {
        try {
            pastPlanText = await extractPdfText(req.files['pdfFile'][0].buffer, 8000);
        } catch (err) {
            console.error('PDF parse error:', err);
            return res.status(400).json({ error: '計画書PDFの読み取りに失敗しました。' });
        }
    }

    // アセスメントシートPDF解析
    let assessmentPdfText = '';
    if (req.files && req.files['assessmentPdf'] && req.files['assessmentPdf'][0]) {
        try {
            assessmentPdfText = await extractPdfText(req.files['assessmentPdf'][0].buffer, 6000);
        } catch (err) {
            console.error('Assessment PDF parse error:', err);
            return res.status(400).json({ error: 'アセスメントシートPDFの読み取りに失敗しました。' });
        }
    }

    const model = 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const prompt = buildPrompt({
        childName, childAge, childProfile, childStatus,
        assessment, assessmentPdfText, familyWishes, longTermGoal, shortTermGoal,
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

    // アセスメント（テキスト入力 + PDFテキスト）
    const assessmentParts = [];
    if (data.assessment) assessmentParts.push(data.assessment);
    if (data.assessmentPdfText) assessmentParts.push('【アセスメントシートPDFより抽出】\n' + data.assessmentPdfText);
    if (assessmentParts.length > 0) {
        sections.push(`【アセスメント（現在の状況評価）】
${assessmentParts.join('\n\n')}`);
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
公式の個別支援計画書フォーマットに従って、必ず以下の構成で出力してください。

## 1. 総合所見
利用者の全体像と総合的な援助の方針を、保護者にも分かりやすく温かみのある文章で記述してください（200〜300字程度）。

## 2. 個別支援計画

以下のMarkdown表形式で出力してください。各行は5領域（健康・生活、運動・感覚、認知・行動、言語・コミュニケーション、人間関係・社会性）および家族支援・移行支援に対応する計7行程度にしてください。

※「具体的な達成目標」は日常生活に即した抽象的・方向性のある表現で記述し、過度に具体的なプログラム名は避けてください。
※「支援内容」は「→ これを促すために、○○などの支援を行う」の形式で2〜3つ程度にまとめてください。
※「担当者/提供機関」は「児発管／事業所スタッフ」「保護者／学校」など役割で記述してください。

| 項目（本人のニーズ等） | 具体的な達成目標 | 支援内容 | 達成時期 | 担当者/提供機関 | 留意事項（本人の役割を含む） |
|---|---|---|---|---|---|
| 健康・生活 | （方向性のある目標） | → これを促すために、○○などの支援を行う | 6ヶ月後 | 事業所スタッフ | （本人が取り組むこと・配慮点） |
| 運動・感覚 | | | | | |
| 認知・行動 | | | | | |
| 言語・コミュニケーション | | | | | |
| 人間関係・社会性 | | | | | |
| 家族支援 | ご家族や関係機関と連携し情報共有することで集団・個別のサポートを受けることができる | 必要に応じて相談支援（家族支援・関係機関連携・訪問支援・個別支援） | 随時 | 児発管／事業所 | ご家族と情報を共有しご協力いただく |
| 移行支援 | 新しい環境への適応をスムーズに行える | → 進学・進級に向けた環境調整や情報連携を行う | 移行期 | 児発管／学校 | 本人の不安に配慮し段階的に |

## 3. 保護者・スタッフへの伝え方
温かみのある言葉で、保護者やスタッフに上記の計画を伝える際のポイントを短く記述してください。

## 4. 補足（専門用語の解説）
計画内で使用した専門用語があれば簡潔に解説してください。

それでは、プロの児発管の視点から出力をお願いします。`);

    return sections.join('\n\n');
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
