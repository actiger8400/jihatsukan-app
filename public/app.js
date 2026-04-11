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

// アセスメントシートPDFのフィードバック
assessmentPdfInput.addEventListener('change', () => {
    const file = assessmentPdfInput.files[0];
    if (file) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        assessmentPdfStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${file.name}（${sizeMB}MB）を選択中`;
        assessmentPdfStatus.style.color = '#4CAF50';
    } else {
        assessmentPdfStatus.textContent = '';
    }
});

// Generate Plan Logic
planForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const status = document.getElementById('childStatus').value.trim();
    if (!status) {
        alert('日々の様子・気になる特性を入力してください。');
        return;
    }

    // FormDataでファイルとテキストを送信
    const formData = new FormData();
    formData.append('childName', document.getElementById('childName').value.trim());
    formData.append('childAge', document.getElementById('childAge').value.trim());
    formData.append('childProfile', document.getElementById('childProfile').value.trim());
    formData.append('childStatus', status);
    formData.append('assessment', document.getElementById('assessment').value.trim());
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

// Copy to Clipboard
copyBtn.addEventListener('click', () => {
    const textToCopy = resultContent.innerText;
    navigator.clipboard.writeText(textToCopy).then(() => {
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> コピーしました';
        setTimeout(() => {
            copyBtn.innerHTML = originalText;
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy: ', err);
        alert('コピーに失敗しました。');
    });
});

// PDF Export
pdfBtn.addEventListener('click', () => {
    const childName = document.getElementById('childName').value.trim() || '利用者';
    const today = new Date().toISOString().slice(0, 10);
    const filename = `個別支援計画書_${childName}_${today}.pdf`;

    const originalText = pdfBtn.innerHTML;
    pdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 作成中...';
    pdfBtn.disabled = true;

    // PDF用のクローンを作成（レイアウト崩れ防止）
    const pdfContainer = document.createElement('div');
    pdfContainer.innerHTML = resultContent.innerHTML;
    pdfContainer.style.cssText = `
        font-family: 'M PLUS Rounded 1c', sans-serif;
        color: #4e342e;
        font-size: 11pt;
        line-height: 1.8;
        padding: 0;
        width: 170mm;
    `;

    // PDF用スタイル調整
    const style = document.createElement('style');
    style.textContent = `
        .pdf-export h2 {
            color: #FF5722;
            font-size: 14pt;
            border-bottom: 2px solid #FFC107;
            padding-bottom: 4px;
            margin-top: 20px;
            margin-bottom: 10px;
            page-break-after: avoid;
        }
        .pdf-export h3 {
            color: #FF5722;
            font-size: 12pt;
            margin-top: 16px;
            margin-bottom: 8px;
            page-break-after: avoid;
        }
        .pdf-export p {
            margin-bottom: 8px;
            orphans: 3;
            widows: 3;
        }
        .pdf-export ul, .pdf-export ol {
            margin-bottom: 8px;
            padding-left: 20px;
        }
        .pdf-export li {
            margin-bottom: 4px;
            page-break-inside: avoid;
        }
        .pdf-export blockquote {
            border-left: 3px solid #FF9800;
            padding-left: 10px;
            margin: 8px 0;
            color: #795548;
        }
    `;
    pdfContainer.classList.add('pdf-export');
    pdfContainer.prepend(style);

    // body外に一時配置（非表示だが描画される）
    pdfContainer.style.position = 'absolute';
    pdfContainer.style.left = '-9999px';
    document.body.appendChild(pdfContainer);

    const opt = {
        margin: [15, 15, 15, 15],
        filename: filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, width: pdfContainer.scrollWidth },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: 'css', avoid: ['h2', 'h3', 'li'] }
    };

    html2pdf().set(opt).from(pdfContainer).save().then(() => {
        document.body.removeChild(pdfContainer);
        pdfBtn.innerHTML = '<i class="fa-solid fa-check"></i> 保存しました';
        setTimeout(() => {
            pdfBtn.innerHTML = originalText;
            pdfBtn.disabled = false;
        }, 2000);
    }).catch(err => {
        console.error('PDF export error:', err);
        document.body.removeChild(pdfContainer);
        alert('PDF出力に失敗しました。');
        pdfBtn.innerHTML = originalText;
        pdfBtn.disabled = false;
    });
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
