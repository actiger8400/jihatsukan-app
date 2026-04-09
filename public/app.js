// DOM Elements
const planForm = document.getElementById('planForm');
const generateBtn = document.getElementById('generateBtn');
const resultContainer = document.getElementById('resultContainer');
const loadingIndicator = document.getElementById('loadingIndicator');
const resultContent = document.getElementById('resultContent');
const copyBtn = document.getElementById('copyBtn');
const pdfFileInput = document.getElementById('pdfFile');
const pdfStatus = document.getElementById('pdfStatus');

// PDF選択時のフィードバック
pdfFileInput.addEventListener('change', () => {
    const file = pdfFileInput.files[0];
    if (file) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        pdfStatus.textContent = `${file.name}（${sizeMB}MB）を選択中`;
        pdfStatus.style.color = '#4e342e';
    } else {
        pdfStatus.textContent = '';
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

    // UI Feedback
    generateBtn.disabled = true;
    resultContainer.classList.remove('hidden');
    loadingIndicator.classList.remove('hidden');
    resultContent.innerHTML = '';
    resultContainer.scrollIntoView({ behavior: 'smooth' });

    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            body: formData // Content-TypeはFormDataが自動設定
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
