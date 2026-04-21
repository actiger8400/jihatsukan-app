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

    // 入力チェック: アセスメント/日々の様子/過去計画書のいずれかが必要
    if (!assessmentPdfText && !assessment && !childStatus && !pastPlanText) {
        return res.status(400).json({ error: 'アセスメントシート、アセスメント補足、日々の様子、過去の計画書のいずれかを入力してください。' });
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
基本情報（診断名、発達段階など）: ${data.childProfile || '未記入'}`);

    // アセスメント（メイン情報源）
    const assessmentParts = [];
    if (data.assessmentPdfText) assessmentParts.push('【アセスメントシートPDFより抽出】\n' + data.assessmentPdfText);
    if (data.assessment) assessmentParts.push('【アセスメント補足】\n' + data.assessment);
    if (assessmentParts.length > 0) {
        sections.push(`【アセスメント（メイン情報源・現在の状況評価）】
以下のアセスメント情報を最優先で参照し、5領域別の支援計画を構築してください。
${assessmentParts.join('\n\n')}`);
    }

    // 日々の様子（補足情報）
    if (data.childStatus) {
        sections.push(`【日々の様子（補足）】
${data.childStatus}`);
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
放課後等デイサービスの公式個別支援計画書フォーマットに従って、必ず以下の構成・順番で出力してください。
各セクションの見出しはMarkdown形式で記述してください。

## 利用児及び家族の生活に対する意向
利用者と保護者からの聞き取りに基づき、家族の生活に対する意向・希望・困り事を具体的に記述してください。保護者の言葉をそのまま活かすような文体で書いてください（3〜5行程度）。

## 総合的な支援の方針
支援全体の方向性を簡潔に箇条書き（2〜3項目）で記述してください。

## 長期目標（内容・期間等）
1年間で達成を目指す目標を箇条書き（2項目程度）で記述してください。

## 短期目標（内容・期間等）
6ヶ月で達成を目指す目標を箇条書き（2項目程度）で記述してください。

## 備考
以下の定型文を記述してください。
「必要に応じて、家族支援・専門的支援・通所自立支援・集中的支援・子育てサポート・自立サポート・医療連携体制・関係機関との連携を実施していきます。（加算要件含む）」

## 個別支援計画

以下のMarkdown表形式で5行（5領域に対応）を出力してください。

※「項目」列は「生活面」「運動・感覚」「認知・行動」「言語」「社会性」としてください。
※「具体的な達成目標」は日常生活に即した方向性のある簡潔な表現にしてください（例：「身辺自立と身だしなみ」「保有する感覚の総合的な活用」など）。
※「支援内容」は、現場スタッフが読んで実践できる具体的な支援の記述にしてください。最後に対応する5領域名を記載してください。
※「留意事項」は本人への配慮点やスタッフの対応上の注意を記述してください。

| 項目（本人のニーズ等） | 具体的な達成目標 | 支援内容（内容・支援の提供上のポイント・5領域との関連性等） | 達成時期 | 留意事項（本人の役割を含む） |
|---|---|---|---|---|
| 生活面 | （簡潔な目標） | （具体的な支援内容を記述）　＜健康や生活＞ | 6か月 | （配慮点） |
| 運動・感覚 | （簡潔な目標） | （具体的な支援内容を記述）　＜運動や感覚＞ | 6か月 | （配慮点） |
| 認知・行動 | （簡潔な目標） | （具体的な支援内容を記述）　＜認知や行動＞ | 6か月 | （配慮点） |
| 言語 | （簡潔な目標） | （具体的な支援内容を記述）　＜言語やコミュニケーション＞ | 6か月 | （配慮点） |
| 社会性 | （簡潔な目標） | （具体的な支援内容を記述）　＜人間関係や社会性＞ | 6か月 | （配慮点） |

それでは、プロの児発管の視点から出力をお願いします。`);

    return sections.join('\n\n');
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
