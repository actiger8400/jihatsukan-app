// タブ切り替え
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-content').forEach(c => {
            c.classList.toggle('active', c.id === `tab-${target}`);
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
});

// DOM Elements
const planForm = document.getElementById('planForm');
const generateBtn = document.getElementById('generateBtn');
const resultContainer = document.getElementById('resultContainer');
const loadingIndicator = document.getElementById('loadingIndicator');
const resultContent = document.getElementById('resultContent');
const copyBtn = document.getElementById('copyBtn');
const resetBtn = document.getElementById('resetBtn');
const pdfBtn = document.getElementById('pdfBtn');
const pdfFileInput = document.getElementById('pdfFile');
const pdfStatus = document.getElementById('pdfStatus');
const assessmentPdfInput = document.getElementById('assessmentPdf');
const assessmentPdfStatus = document.getElementById('assessmentPdfStatus');

// 過去の計画書PDFアップロード → 自動抽出
pdfFileInput.addEventListener('change', async () => {
    const file = pdfFileInput.files[0];
    if (!file) {
        pdfStatus.textContent = '';
        return;
    }

    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    pdfStatus.textContent = `${file.name}（${sizeMB}MB）を読み取り中...`;
    pdfStatus.style.color = '#795548';

    // サーバーに送ってフィールド自動抽出
    const formData = new FormData();
    formData.append('pdfFile', file);

    try {
        const response = await fetch('/api/extract-pdf', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            pdfStatus.textContent = `${file.name}（${sizeMB}MB） - 読み取りエラー`;
            pdfStatus.style.color = '#f44336';
            return;
        }

        // 抽出結果をフォームに自動入力（空でない場合のみ）
        let filledCount = 0;
        const fields = [
            { id: 'childName', value: data.childName },
            { id: 'childAge', value: data.childAge },
            { id: 'childProfile', value: data.childProfile },
            { id: 'familyWishes', value: data.familyWishes },
            { id: 'longTermGoal', value: data.longTermGoal },
            { id: 'shortTermGoal', value: data.shortTermGoal }
        ];

        fields.forEach(field => {
            if (field.value) {
                const el = document.getElementById(field.id);
                // 既に入力がある場合は上書きしない
                if (!el.value.trim()) {
                    el.value = field.value;
                    el.classList.add('auto-filled');
                    setTimeout(() => el.classList.remove('auto-filled'), 3000);
                    filledCount++;
                }
            }
        });

        if (filledCount > 0) {
            pdfStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${file.name}（${sizeMB}MB）- ${filledCount}件の項目を自動入力しました`;
            pdfStatus.style.color = '#4CAF50';
        } else {
            pdfStatus.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${file.name}（${sizeMB}MB）- 読み取り完了（自動入力できる項目はありませんでした）`;
            pdfStatus.style.color = '#FF9800';
        }
    } catch (err) {
        console.error('PDF extract error:', err);
        pdfStatus.textContent = `${file.name}（${sizeMB}MB） - 読み取りに失敗しました`;
        pdfStatus.style.color = '#f44336';
    }
});

// アセスメントシートPDF: フィードバック + 補助セクション切り替え
const fallbackSections = document.getElementById('fallbackSections');
function updateFallbackVisibility() {
    const hasAssessment = !!assessmentPdfInput.files[0];
    fallbackSections.classList.toggle('hidden', hasAssessment);
}
assessmentPdfInput.addEventListener('change', () => {
    const file = assessmentPdfInput.files[0];
    if (file) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        assessmentPdfStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${file.name}（${sizeMB}MB）を選択中`;
        assessmentPdfStatus.style.color = '#4CAF50';
    } else {
        assessmentPdfStatus.textContent = '';
    }
    updateFallbackVisibility();
});
// 初期表示
updateFallbackVisibility();

// Generate Plan Logic
planForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const status = document.getElementById('childStatus').value.trim();
    const assessment = document.getElementById('assessment').value.trim();
    const hasAssessmentPdf = !!assessmentPdfInput.files[0];
    const hasPastPdf = !!pdfFileInput.files[0];

    if (!hasAssessmentPdf && !assessment && !status && !hasPastPdf) {
        alert('アセスメントシート、アセスメント補足、日々の様子、過去の計画書のいずれかを入力してください。');
        return;
    }

    // FormDataでファイルとテキストを送信
    const formData = new FormData();
    formData.append('childName', document.getElementById('childName').value.trim());
    formData.append('childAge', document.getElementById('childAge').value.trim());
    formData.append('childProfile', document.getElementById('childProfile').value.trim());
    formData.append('childStatus', status);
    formData.append('assessment', assessment);
    formData.append('familyWishes', document.getElementById('familyWishes').value.trim());
    formData.append('longTermGoal', document.getElementById('longTermGoal').value.trim());
    formData.append('shortTermGoal', document.getElementById('shortTermGoal').value.trim());
    formData.append('classroomName', document.getElementById('classroomName').value.trim());
    formData.append('classroomPolicy', document.getElementById('classroomPolicy').value.trim());

    // PDFファイル
    const pdfFile = pdfFileInput.files[0];
    if (pdfFile) {
        formData.append('pdfFile', pdfFile);
    }

    // アセスメントシートPDF
    const assessmentPdf = assessmentPdfInput.files[0];
    if (assessmentPdf) {
        formData.append('assessmentPdf', assessmentPdf);
    }

    // UI Feedback
    generateBtn.disabled = true;
    resultContainer.classList.remove('hidden');
    loadingIndicator.classList.remove('hidden');
    resultContent.innerHTML = '';
    resultContainer.scrollIntoView({ behavior: 'smooth' });

    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'APIエラーが発生しました。');
        }

        const rawHtml = marked.parse(data.result);
        const cleanHtml = DOMPurify.sanitize(rawHtml);

        loadingIndicator.classList.add('hidden');
        resultContent.innerHTML = cleanHtml;
    } catch (error) {
        console.error('Error generating plan:', error);
        loadingIndicator.classList.add('hidden');
        resultContent.innerHTML = DOMPurify.sanitize(
            '<div style="color: red; padding: 10px; background: rgba(255,0,0,0.1); border-radius: 5px;">' +
            '<p><strong>エラーが発生しました:</strong></p>' +
            '<p>' + error.message + '</p>' +
            '</div>'
        );
    } finally {
        generateBtn.disabled = false;
    }
});

// Copy to Clipboard (HTML + プレーンテキスト両方で表を保持)
copyBtn.addEventListener('click', async () => {
    const originalText = copyBtn.innerHTML;

    // HTML形式（Word/Excel/Googleドキュメント等で表が保持される）
    const htmlContent = resultContent.innerHTML;

    // プレーンテキスト形式（テキストエディタ用、表はTSV化）
    const plainText = htmlToPlainTextWithTables(resultContent);

    try {
        // ClipboardItem で HTML と plain/text の両方を同時書き込み
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
            const item = new ClipboardItem({
                'text/html': new Blob([htmlContent], { type: 'text/html' }),
                'text/plain': new Blob([plainText], { type: 'text/plain' })
            });
            await navigator.clipboard.write([item]);
        } else {
            // フォールバック: プレーンテキストのみ
            await navigator.clipboard.writeText(plainText);
        }

        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> 表ごとコピーしました';
        setTimeout(() => {
            copyBtn.innerHTML = originalText;
        }, 2000);
    } catch (err) {
        console.error('Failed to copy: ', err);
        // 失敗時は最低限プレーンテキストだけでも
        try {
            await navigator.clipboard.writeText(plainText);
            copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> コピーしました';
            setTimeout(() => { copyBtn.innerHTML = originalText; }, 2000);
        } catch {
            alert('コピーに失敗しました。');
        }
    }
});

// HTML→プレーンテキスト変換（表はタブ区切りに）
function htmlToPlainTextWithTables(rootEl) {
    const clone = rootEl.cloneNode(true);
    // 表をTSVに置換
    clone.querySelectorAll('table').forEach(table => {
        const rows = Array.from(table.querySelectorAll('tr')).map(tr =>
            Array.from(tr.querySelectorAll('th,td'))
                .map(cell => cell.innerText.replace(/\s+/g, ' ').trim())
                .join('\t')
        );
        const placeholder = document.createElement('pre');
        placeholder.textContent = rows.join('\n');
        table.replaceWith(placeholder);
    });
    return clone.innerText;
}

// PDF Export（印刷ダイアログ経由で「PDFに保存」）
pdfBtn.addEventListener('click', () => {
    // 結果コンテンツだけを印刷する新しいウィンドウを開く
    const printWindow = window.open('', '_blank');
    const childName = document.getElementById('childName').value.trim() || '利用者';
    const today = new Date().toISOString().slice(0, 10);

    printWindow.document.write(`<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>個別支援計画書_${childName}_${today}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        @page {
            size: A4;
            margin: 20mm 18mm;
        }
        body {
            font-family: 'M PLUS Rounded 1c', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif;
            color: #333;
            font-size: 11pt;
            line-height: 1.9;
            margin: 0;
            padding: 0;
        }
        h1.doc-title {
            text-align: center;
            font-size: 16pt;
            color: #4e342e;
            border-bottom: 3px solid #FF9800;
            padding-bottom: 8px;
            margin-bottom: 6px;
        }
        .doc-meta {
            text-align: center;
            font-size: 9pt;
            color: #888;
            margin-bottom: 20px;
        }
        h2 {
            color: #E65100;
            font-size: 13pt;
            border-bottom: 2px solid #FFB74D;
            padding-bottom: 3px;
            margin-top: 24px;
            margin-bottom: 10px;
            page-break-after: avoid;
        }
        h3 {
            color: #EF6C00;
            font-size: 11.5pt;
            margin-top: 18px;
            margin-bottom: 6px;
            page-break-after: avoid;
        }
        p {
            margin: 0 0 8px 0;
            text-align: justify;
        }
        ul, ol {
            margin: 4px 0 10px 0;
            padding-left: 22px;
        }
        li {
            margin-bottom: 3px;
            page-break-inside: avoid;
        }
        strong {
            color: #4e342e;
        }
        blockquote {
            border-left: 3px solid #FF9800;
            padding-left: 12px;
            margin: 8px 0;
            color: #666;
        }
        hr {
            border: none;
            border-top: 1px solid #ddd;
            margin: 16px 0;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 12px 0;
            font-size: 9pt;
            line-height: 1.5;
            page-break-inside: auto;
        }
        th {
            background: #FFF3E0;
            color: #4e342e;
            padding: 6px 8px;
            border: 1px solid #999;
            text-align: center;
            font-weight: 700;
            font-size: 8.5pt;
        }
        td {
            padding: 6px 8px;
            border: 1px solid #999;
            vertical-align: top;
        }
        tr {
            page-break-inside: avoid;
        }
    </style>
</head>
<body>
    <h1 class="doc-title">個別支援計画書</h1>
    <div class="doc-meta">利用者名: ${childName}　｜　作成日: ${today}</div>
    ${resultContent.innerHTML}
</body>
</html>`);
    printWindow.document.close();

    // フォント読み込み待ちしてから印刷
    printWindow.onload = () => {
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 500);
    };
});

// Reset Button
resetBtn.addEventListener('click', () => {
    if (!confirm('フォームと結果をリセットしますか？')) return;

    // フォームリセット
    planForm.reset();

    // ファイル選択状態クリア
    pdfStatus.textContent = '';
    assessmentPdfStatus.textContent = '';

    // 結果非表示
    resultContainer.classList.add('hidden');
    resultContent.innerHTML = '';
    loadingIndicator.classList.add('hidden');

    // 画面トップにスクロール
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ==========================================
// フェーズ2: 支援プログラム生成
// ==========================================
const programForm = document.getElementById('programForm');
const planPdfsInput = document.getElementById('planPdfs');
const planPdfsStatus = document.getElementById('planPdfsStatus');
const generateProgramBtn = document.getElementById('generateProgramBtn');
const programResultContainer = document.getElementById('programResultContainer');
const programLoading = document.getElementById('programLoading');
const programResultContent = document.getElementById('programResultContent');
const programModeBadge = document.getElementById('programModeBadge');
const programCopyBtn = document.getElementById('programCopyBtn');
const programPdfBtn = document.getElementById('programPdfBtn');

planPdfsInput.addEventListener('change', () => {
    const files = Array.from(planPdfsInput.files);
    if (files.length === 0) {
        planPdfsStatus.textContent = '';
        return;
    }
    const totalMB = (files.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1);
    const mode = files.length >= 2 ? '集団プログラム' : '個別支援プログラム';
    planPdfsStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${files.length}名分を選択中（計${totalMB}MB） → <strong>${mode}</strong>として生成されます`;
    planPdfsStatus.style.color = '#4CAF50';
});

programForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const files = Array.from(planPdfsInput.files);
    if (files.length === 0) {
        alert('個別支援計画書のPDFを1件以上アップロードしてください。');
        return;
    }

    const formData = new FormData();
    files.forEach(f => formData.append('planPdfs', f));
    formData.append('classroomName', document.getElementById('programClassroomName').value.trim());
    formData.append('classroomPolicy', document.getElementById('programClassroomPolicy').value.trim());
    formData.append('sessionDuration', document.getElementById('sessionDuration').value.trim());
    formData.append('additionalNote', document.getElementById('additionalNote').value.trim());

    generateProgramBtn.disabled = true;
    programResultContainer.classList.remove('hidden');
    programLoading.classList.remove('hidden');
    programResultContent.innerHTML = '';
    programResultContainer.scrollIntoView({ behavior: 'smooth' });

    try {
        const response = await fetch('/api/generate-program', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'APIエラー');

        const rawHtml = marked.parse(data.result);
        const cleanHtml = DOMPurify.sanitize(rawHtml);

        programLoading.classList.add('hidden');
        programResultContent.innerHTML = cleanHtml;
        programModeBadge.textContent = data.mode === 'group'
            ? `集団プログラム（${data.count}名）`
            : `個別プログラム（${data.count}名）`;
    } catch (error) {
        console.error('Program generation error:', error);
        programLoading.classList.add('hidden');
        programResultContent.innerHTML = DOMPurify.sanitize(
            '<div style="color: red; padding: 10px; background: rgba(255,0,0,0.1); border-radius: 5px;">' +
            '<p><strong>エラーが発生しました:</strong></p>' +
            '<p>' + error.message + '</p>' +
            '</div>'
        );
    } finally {
        generateProgramBtn.disabled = false;
    }
});

// プログラム結果のコピー
programCopyBtn.addEventListener('click', async () => {
    const original = programCopyBtn.innerHTML;
    const html = programResultContent.innerHTML;
    const plain = htmlToPlainTextWithTables(programResultContent);
    try {
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
            const item = new ClipboardItem({
                'text/html': new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([plain], { type: 'text/plain' })
            });
            await navigator.clipboard.write([item]);
        } else {
            await navigator.clipboard.writeText(plain);
        }
        programCopyBtn.innerHTML = '<i class="fa-solid fa-check"></i> コピーしました';
        setTimeout(() => programCopyBtn.innerHTML = original, 2000);
    } catch {
        alert('コピーに失敗しました。');
    }
});

// プログラム結果のPDF出力
programPdfBtn.addEventListener('click', () => {
    const printWindow = window.open('', '_blank');
    const today = new Date().toISOString().slice(0, 10);
    const title = programModeBadge.textContent || 'プログラム';
    printWindow.document.write(`<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>支援プログラム_${today}</title>
<link href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;500;700&display=swap" rel="stylesheet">
<style>
@page { size: A4; margin: 20mm 18mm; }
body { font-family: 'M PLUS Rounded 1c', sans-serif; color: #333; font-size: 11pt; line-height: 1.8; }
h1.doc-title { text-align: center; font-size: 16pt; color: #4e342e; border-bottom: 3px solid #FF9800; padding-bottom: 8px; }
.doc-meta { text-align: center; font-size: 9pt; color: #888; margin-bottom: 20px; }
h2 { color: #E65100; font-size: 13pt; border-bottom: 2px solid #FFB74D; padding-bottom: 3px; margin-top: 20px; page-break-after: avoid; }
h3 { color: #EF6C00; font-size: 11.5pt; margin-top: 16px; page-break-after: avoid; }
table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 9pt; }
th { background: #FFF3E0; padding: 6px; border: 1px solid #999; }
td { padding: 6px; border: 1px solid #999; vertical-align: top; }
tr { page-break-inside: avoid; }
</style></head><body>
<h1 class="doc-title">支援プログラム</h1>
<div class="doc-meta">${title}　｜　作成日: ${today}</div>
${programResultContent.innerHTML}
</body></html>`);
    printWindow.document.close();
    printWindow.onload = () => setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
});
