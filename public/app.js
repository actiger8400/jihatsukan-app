// DOM Elements
const planForm = document.getElementById('planForm');
const childProfileInput = document.getElementById('childProfile');
const childStatusInput = document.getElementById('childStatus');
const generateBtn = document.getElementById('generateBtn');

const resultContainer = document.getElementById('resultContainer');
const loadingIndicator = document.getElementById('loadingIndicator');
const resultContent = document.getElementById('resultContent');
const copyBtn = document.getElementById('copyBtn');

// Generate Plan Logic
planForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const profile = childProfileInput.value.trim();
    const status = childStatusInput.value.trim();

    if (!status) {
        alert('日々の様子・気になる特性を入力してください。');
        return;
    }

    // UI Feedback
    generateBtn.disabled = true;
    resultContainer.classList.remove('hidden');
    loadingIndicator.classList.remove('hidden');
    resultContent.innerHTML = '';

    // Smooth scroll to result
    resultContainer.scrollIntoView({ behavior: 'smooth' });

    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile, status })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'APIエラーが発生しました。');
        }

        // Parse Markdown and Sanitize
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
