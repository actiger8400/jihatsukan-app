// DOM Elements
const planForm = document.getElementById('planForm');
const generateBtn = document.getElementById('generateBtn');
const resultContainer = document.getElementById('resultContainer');
const loadingIndicator = document.getElementById('loadingIndicator');
const resultContent = document.getElementById('resultContent');
const copyBtn = document.getElementById('copyBtn');
const resetBtn = document.getElementById('resetBtn');
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

// アセスメントシートPDFアップロード → 自動抽出
assessmentPdfInput.addEventListener('change', async () => {
    const file = assessmentPdfInput.files[0];
    if (!file) {
        assessmentPdfStatus.textContent = '';
        return;
    }

    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    assessmentPdfStatus.textContent = `${file.name}（${sizeMB}MB）を読み取り中...`;
    assessmentPdfStatus.style.color = '#795548';

    const formData = new FormData();
    formData.append('assessmentPdf', file);

    try {
        const response = await fetch('/api/extract-assessment', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            assessmentPdfStatus.textContent = `${file.name} - 読み取りエラー`;
            assessmentPdfStatus.style.color = '#f44336';
            return;
        }

        // 抽出結果をフォームに自動入力
        let filledCount = 0;
        const fields = [
            { id: 'childStatus', value: data.childStatus },
            { id: 'childName', value: data.childName },
            { id: 'childAge', value: data.childAge },
            { id: 'childProfile', value: data.childProfile },
            { id: 'assessment', value: data.assessment }
        ];

        fields.forEach(field => {
            if (field.value) {
                const el = document.getElementById(field.id);
                if (!el.value.trim()) {
                    el.value = field.value;
                    el.classList.add('auto-filled');
                    setTimeout(() => el.classList.remove('auto-filled'), 3000);
                    filledCount++;
                }
            }
        });

        const labels = [];
        if (data.childStatus) labels.push('日々の様子');
        if (data.childName) labels.push('氏名');
        if (data.childAge) labels.push('年齢');
        if (data.childProfile) labels.push('診断名');
        if (data.assessment) labels.push('アセスメント');

        if (filledCount > 0) {
            assessmentPdfStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${file.name}（${sizeMB}MB）- ${labels.join('・')}を自動入力しました`;
            assessmentPdfStatus.style.color = '#4CAF50';
        } else {
            assessmentPdfStatus.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${file.name}（${sizeMB}MB）- 読み取り完了（自動入力できる項目はありませんでした）`;
            assessmentPdfStatus.style.color = '#FF9800';
        }
    } catch (err) {
        console.error('Assessment PDF extract error:', err);
        assessmentPdfStatus.textContent = `${file.name} - 読み取りに失敗しました`;
        assessmentPdfStatus.style.color = '#f44336';
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
