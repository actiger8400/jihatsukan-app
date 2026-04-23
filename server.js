require('dotenv').config();
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const app = express();
const PORT = process.env.PORT || 3000;

// multer: メモリストレージ（ファイルをディスクに保存しない）
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB（Gemini API制限 20MB より小さく）
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

// プログラム生成用（複数PDF）
const programUpload = upload.array('planPdfs', 30);

app.use(express.json({ limit: '50mb' }));
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

    // PDFファイル取得
    const pastPdfFile = req.files && req.files['pdfFile'] && req.files['pdfFile'][0];
    const assessmentPdfFile = req.files && req.files['assessmentPdf'] && req.files['assessmentPdf'][0];

    // 過去の計画書PDF: テキスト抽出（印字なら成功、手書きは空になる）
    let pastPlanText = '';
    if (pastPdfFile) {
        try {
            pastPlanText = await extractPdfText(pastPdfFile.buffer, 8000);
        } catch (err) {
            console.error('PDF parse error:', err);
        }
    }

    // アセスメントPDF: テキスト抽出
    let assessmentPdfText = '';
    if (assessmentPdfFile) {
        try {
            assessmentPdfText = await extractPdfText(assessmentPdfFile.buffer, 6000);
        } catch (err) {
            console.error('Assessment PDF parse error:', err);
        }
    }

    // 入力チェック: アセスメント/日々の様子/過去計画書のいずれかが必要
    if (!assessmentPdfFile && !assessmentPdfText && !assessment && !childStatus && !pastPdfFile && !pastPlanText) {
        return res.status(400).json({ error: 'アセスメントシート、アセスメント補足、日々の様子、過去の計画書のいずれかを入力してください。' });
    }

    const model = 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const prompt = buildPrompt({
        childName, childAge, childProfile, childStatus,
        assessment, assessmentPdfText, familyWishes, longTermGoal, shortTermGoal,
        classroomName, classroomPolicy, pastPlanText,
        hasAssessmentPdf: !!assessmentPdfFile,
        hasPastPdf: !!pastPdfFile
    });

    // Geminiへ送るパート構築: プロンプト + PDFファイル（inline_data）
    const parts = [{ text: prompt }];

    // アセスメントPDFを画像として同梱（手書き対応）
    if (assessmentPdfFile) {
        parts.push({
            inline_data: {
                mime_type: 'application/pdf',
                data: assessmentPdfFile.buffer.toString('base64')
            }
        });
    }
    // 過去計画書PDFも同梱
    if (pastPdfFile) {
        parts.push({
            inline_data: {
                mime_type: 'application/pdf',
                data: pastPdfFile.buffer.toString('base64')
            }
        });
    }

    const requestBody = {
        contents: [{ parts }],
        generationConfig: {
            temperature: 0.4
        }
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

// ==========================================
// プログラム生成エンドポイント（複数計画書PDF→支援プログラム）
// ==========================================
app.post('/api/generate-program', programUpload, async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'サーバーにAPIキーが設定されていません。' });
    }

    const files = req.files || [];
    if (files.length === 0) {
        return res.status(400).json({ error: '個別支援計画書PDFを1件以上アップロードしてください。' });
    }

    const classroomName = (req.body.classroomName || '').trim();
    const classroomPolicy = (req.body.classroomPolicy || '').trim();
    const sessionDuration = (req.body.sessionDuration || '').trim();
    const additionalNote = (req.body.additionalNote || '').trim();

    const isGroup = files.length >= 2;
    const model = 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const prompt = buildProgramPrompt({
        fileCount: files.length,
        isGroup,
        classroomName,
        classroomPolicy,
        sessionDuration,
        additionalNote
    });

    // parts: プロンプト + 各PDFをinline_dataで同梱
    const parts = [{ text: prompt }];
    for (const f of files) {
        parts.push({
            inline_data: {
                mime_type: 'application/pdf',
                data: f.buffer.toString('base64')
            }
        });
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: { temperature: 0.4 }
            })
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('Gemini API Error (program):', data);
            return res.status(response.status).json({
                error: data.error?.message || `Gemini API Error: ${response.status}`
            });
        }
        if (data.candidates && data.candidates[0].content) {
            res.json({
                result: data.candidates[0].content.parts[0].text,
                mode: isGroup ? 'group' : 'individual',
                count: files.length
            });
        } else {
            res.status(500).json({ error: '予期しないレスポンス形式です。' });
        }
    } catch (error) {
        console.error('Program generation error:', error);
        res.status(500).json({ error: 'サーバーエラーが発生しました。' });
    }
});

function buildProgramPrompt(opts) {
    const sections = [];

    sections.push(`あなたは児童発達支援管理責任者（児発管）と連携する現場リーダー（サービス提供責任者）です。
添付された個別支援計画書PDF（${opts.fileCount}名分）を全て丁寧に読み取り、5領域（健康・生活、運動・感覚、認知・行動、言語・コミュニケーション、人間関係・社会性）を踏まえた${opts.isGroup ? '集団' : '個別'}支援プログラムを作成してください。

添付PDFには印字と手書きが含まれる可能性があります。すべての記載内容（氏名、達成目標、支援内容、留意事項など）を必ず読み取ってからプログラムを組み立ててください。`);

    if (opts.classroomName || opts.classroomPolicy) {
        sections.push(`【教室情報】
教室名: ${opts.classroomName || '未記入'}
教室の特徴・方針: ${opts.classroomPolicy || '未記入'}`);
    }

    if (opts.sessionDuration) {
        sections.push(`【1回あたりの支援時間】
${opts.sessionDuration}`);
    }

    if (opts.additionalNote) {
        sections.push(`【追加の指示・条件】
${opts.additionalNote}`);
    }

    if (opts.isGroup) {
        sections.push(`【出力フォーマット要件（集団プログラム）】
以下の構成・順番でMarkdown形式で出力してください。挨拶文や前置きは一切不要です。

## 対象児童一覧
添付PDFから読み取れた対象児童を表で記載してください。
| # | 氏名 | 年齢 | 主な支援目標（5領域別の抜粋） |
|---|---|---|---|

## 共通する支援ニーズの分析
全員に共通する課題、半数以上に共通する課題、個別性が高い課題を整理してください（箇条書き）。

## 集団プログラム概要
- **ねらい**: このプログラムで達成を目指すこと
- **対応する5領域**: どの領域に効果があるか
- **配慮する個別性**: 誰にどう配慮するか

## 集団で実施できる支援プログラム（10案）
対象児童全員が参加でき、共通する支援ニーズや5領域のいずれかに沿った具体的な活動プログラムを**10個**提案してください。
それぞれ異なる領域や切り口（運動、感覚、制作、ゲーム、音楽、読み聞かせ、ルール遊び、協力活動、模倣遊び、感情表現など）から偏りなく選んでください。

| # | プログラム名 | 対応する5領域 | 活動内容（具体的に） | ねらい | 所要時間 | 準備物 | 配慮ポイント |
|---|---|---|---|---|---|---|---|
| 1 | （例：フープ渡りリレー） | 運動や感覚／人間関係や社会性 | （具体的な進め方） | （何を育てるか） | 15分 | フープ×6 | （個別配慮） |
（上記の列項目を守り、1〜10まで埋めてください）

## 個別配慮一覧
各児童ごとに、集団プログラムの中で特に注意すべき点を表形式で記載。
| 氏名 | 特に配慮する場面 | 具体的な声かけ・対応例 |
|---|---|---|

## 評価の視点
プログラム実施後、どの観点で評価・記録するかを箇条書きで記載。

## 準備物・必要な環境
物品・スペース・スタッフ配置などを箇条書きで記載。`);
    } else {
        sections.push(`【出力フォーマット要件（個別支援プログラム）】
以下の構成・順番でMarkdown形式で出力してください。挨拶文や前置きは一切不要です。

## 対象児童の情報
添付PDFから読み取れた情報を箇条書きで記載（氏名・年齢・診断名・主な目標）。

## プログラムのねらい
この個別プログラムで達成を目指すこと（3〜5行）。

## 週間支援プログラム表
月曜〜日曜の7日間で実施する支援内容を、曜日ごとに具体的に記載してください。
通所日には具体的な活動プログラム、非通所日には家庭で取り組む内容や連携事項を記載します。
活動は5領域（健康・生活、運動・感覚、認知・行動、言語・コミュニケーション、人間関係・社会性）から偏りなく配置してください。

| 曜日 | 通所/家庭 | メインプログラム | 所要時間 | 対応5領域 | 具体的な活動内容 | ねらい | 評価の観点 |
|---|---|---|---|---|---|---|---|
| 月 | 通所 | （例：ビジョントレーニング） | 20分 | 認知や行動／運動や感覚 | （具体的な進め方・使用教材） | （何を育てるか） | （何を見て評価するか） |
| 火 | 通所 | | | | | | |
| 水 | 家庭 | （例：家庭での般化課題） | — | | （保護者と連携する内容） | | |
| 木 | 通所 | | | | | | |
| 金 | 通所 | | | | | | |
| 土 | 家庭 | | | | | | |
| 日 | 家庭 | | | | | | |

※全7曜日を必ず埋めてください。通所頻度が不明な場合は一般的な週3〜4回通所を想定してください。
※同じ領域ばかりに偏らないよう、週を通して5領域がバランスよく含まれるようにしてください。

## 1セッションの構成例（通所日の1日の流れ）
| 時間 | 活動名 | 具体的な内容 | 支援のポイント・声かけ例 |
|---|---|---|---|
| 到着〜10分 | 入室・荷物整理 | （具体的な流れ） | （声かけ例「○○ができたら〜」） |
| 10〜25分 | （導入活動） | | |
| 25〜50分 | （メインプログラム） | | |
| 50〜60分 | （休憩・切り替え） | | |
| 60〜80分 | （サブプログラム） | | |
| 80〜90分 | 振り返り・帰りの会 | | |

※1セッション90分を想定。実際の利用時間が異なる場合は、その時間に合わせて配分してください。

## 声かけ・関わり方のポイント
本児への具体的な声かけ例、関わり方の留意点を箇条書き。

## 家庭・学校との連携
ご家族や学校と共有すべき情報、協力をお願いすること。

## 評価・見直しの視点
いつ、どのように評価し、プログラムを見直すかを記載。`);
    }

    return sections.join('\n\n');
}

// multerエラーハンドリング
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'ファイルサイズは15MB以下にしてください。' });
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

    // PDF読み取り指示（マルチモーダル）
    if (data.hasAssessmentPdf || data.hasPastPdf) {
        const pdfList = [];
        if (data.hasAssessmentPdf) pdfList.push('アセスメントシート');
        if (data.hasPastPdf) pdfList.push('過去の個別支援計画書');
        sections.push(`【添付PDFの読み取り指示（重要）】
このメッセージには以下のPDFファイルが添付されています: ${pdfList.join('、')}
PDFには印字された文字だけでなく、手書きの記入やチェックマークが含まれている可能性があります。
添付PDFの全ページを丁寧に読み取り、記載された全ての情報（氏名、年齢、質問への回答、保護者の記述内容、チェック項目など）を漏れなく把握してから、支援計画を作成してください。
手書き文字が判読困難な場合は「（判読困難）」と記し、前後の文脈から意図を推測しつつ計画に反映してください。`);
    }

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

【重要】以下は業務用アシスタントの出力です。以下を厳守してください：
- 冒頭に挨拶文や前置き（「この度は…」「ご協力ありがとうございます」等）は一切含めないでください
- 末尾にも締めの挨拶は含めないでください
- 最初の見出し「## 基本情報」から直接出力を開始してください
- 児発管業務のドキュメント作成支援であり、保護者宛の手紙ではありません

## 基本情報
アセスメントシートや入力情報から読み取った基本情報を以下の形式で記述してください。読み取れなかった項目は「—」と記載してください。

- **利用者名**: （氏名・フリガナ）
- **年齢・学年**: （年齢、学年）
- **生年月日**: （読み取れた場合のみ）
- **診断名・発達段階**: （診断名、発達指数など）
- **受給者証番号**: （読み取れた場合のみ）
- **記入者**: （保護者氏名など、読み取れた場合のみ）
- **作成日**: （本日の日付）

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
