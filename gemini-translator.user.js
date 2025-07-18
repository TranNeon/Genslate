// ==UserScript==
// @name         Gemini Page Translator
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Translates webpage text into English using the Google Gemini API, with model selection.
// @author       Neon
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      generativelanguage.googleapis.com
// @downloadURL  https://raw.githubusercontent.com/TranNeon/Genslate/refs/heads/master/gemini-translator.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- CONFIGURATION ---
    const API_KEY_STORAGE = 'gemini_api_key';
    const MODEL_STORAGE = 'gemini_model_selection';
    const DEFAULT_MODEL = 'gemini-2.5-flash'; // Updated to the new fast model
    const AVAILABLE_MODELS = [
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-1.5-pro-latest',
        'gemini-1.5-flash-latest',
        'gemini-pro'
    ];
    const BATCH_CHARACTER_LIMIT = 15000;

    // API URL is now a function to accommodate different models
    function getApiUrl(model, apiKey) {
        return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    }

    // --- UI & FEEDBACK ---

    function showOverlay(text) {
        let overlay = document.getElementById('gemini-translator-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'gemini-translator-overlay';
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            overlay.style.color = 'white';
            overlay.style.display = 'flex';
            overlay.style.justifyContent = 'center';
            overlay.style.alignItems = 'center';
            overlay.style.zIndex = '999999';
            overlay.style.fontSize = '24px';
            overlay.style.fontFamily = 'sans-serif';
            document.body.appendChild(overlay);
        }
        overlay.textContent = text;
        overlay.style.display = 'flex';
    }

    function hideOverlay() {
        let overlay = document.getElementById('gemini-translator-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    // --- SETTINGS PANEL ---

    function createSettingsPanel() {
        const panel = document.createElement('div');
        panel.id = 'gemini-settings-panel';
        panel.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: #2c2c2c;
            color: white;
            border: 1px solid #555;
            border-radius: 8px;
            padding: 15px;
            z-index: 1000000;
            font-family: sans-serif;
            display: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        `;

        panel.innerHTML = `
            <h3 style="margin: 0 0 15px 0; font-size: 16px; border-bottom: 1px solid #555; padding-bottom: 10px;">Translator Settings</h3>
            <label for="gemini-model-select" style="display: block; margin-bottom: 5px;">Translation Model:</label>
            <select id="gemini-model-select" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #666; background-color: #444; color: white;"></select>
            <button id="gemini-settings-close" style="margin-top: 15px; padding: 8px 12px; width: 100%; border: none; border-radius: 4px; background-color: #007bff; color: white; cursor: pointer;">Close</button>
        `;

        document.body.appendChild(panel);

        const select = panel.querySelector('#gemini-model-select');
        AVAILABLE_MODELS.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            select.appendChild(option);
        });

        select.addEventListener('change', async (e) => {
            await GM_setValue(MODEL_STORAGE, e.target.value);
            console.log('Translation model saved:', e.target.value);
        });

        panel.querySelector('#gemini-settings-close').addEventListener('click', () => {
            panel.style.display = 'none';
        });
    }

    async function toggleSettingsPanel() {
        const panel = document.getElementById('gemini-settings-panel');
        if (!panel) return;

        if (panel.style.display === 'none') {
            const currentModel = await GM_getValue(MODEL_STORAGE, DEFAULT_MODEL);
            panel.querySelector('#gemini-model-select').value = currentModel;
            panel.style.display = 'block';
        } else {
            panel.style.display = 'none';
        }
    }


    // --- API & TRANSLATION LOGIC ---

    async function getApiKey() {
        let apiKey = await GM_getValue(API_KEY_STORAGE, null);
        if (!apiKey) {
            apiKey = prompt('Please enter your Google Gemini API Key:');
            if (apiKey) {
                await GM_setValue(API_KEY_STORAGE, apiKey);
                alert('API Key saved. You can now use the translation commands.');
            }
        }
        return apiKey;
    }

    async function translateText(text, apiKey) {
        // FIX: Get the currently selected model from storage.
        const model = await GM_getValue(MODEL_STORAGE, DEFAULT_MODEL);
        console.log(`Translating with model: ${model}`);

        // --- NEW, MORE ROBUST PROMPT ---
        const prompt = `You are an expert translation service. Your task is to translate a batch of text segments from their original language into English.

**Instructions:**
1. The input text contains multiple segments separated by "|||---|||".
2. Translate EACH segment into English.
3. If a segment is already in English, or is a proper noun, brand name, or technical term, keep it as is.
4. Your output MUST preserve the "|||---|||" separator between the translated segments. The number of separators in your output must exactly match the input.
5. Do NOT add any extra text, explanations, or introductions. Provide only the translated text with the separators.

**Example:**
Input: "Bonjour|||---|||Welt|||---|||Hello"
Output: "Hello|||---|||World|||---|||Hello"

**Text to Translate:**
---
${text}
---`;

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: getApiUrl(model, apiKey), // This will now work correctly
                headers: {
                    'Content-Type': 'application/json',
                },
                data: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                }),
                onload: function(response) {
                    // --- DEBUGGING CHECKPOINT 1: Log everything from the API ---
                    console.log('--- Gemini API Response Received ---');
                    console.log('Status:', response.status, response.statusText);
                    console.log('Response Body:', response.responseText);

                    // --- DEBUGGING CHECKPOINT 2: Check for non-successful HTTP status ---
                    if (response.status !== 200) {
                        let errorHint = `The API returned a non-200 status.`;
                        if (response.status === 400) errorHint = "This often means the API key is invalid or the selected model doesn't support the request. Please verify your key and model.";
                        if (response.status === 429) errorHint = "This means you have exceeded your API request quota.";
                        console.error(`API request failed with status ${response.status}.`, response);
                        reject(`API Error: ${response.statusText}. ${errorHint}`);
                        return;
                    }

                    // --- DEBUGGING CHECKPOINT 3: Safely parse the JSON response ---
                    let data;
                    try {
                        data = JSON.parse(response.responseText);
                    } catch (e) {
                        // This is the block that likely triggered your error.
                        console.error('Failed to parse API response. The server did not return valid JSON.', e);
                        reject('Failed to parse API response. Check the console to see the raw response from the server.');
                        return;
                    }

                    // --- DEBUGGING CHECKPOINT 4: Check for a valid translation or an API error message in the JSON ---
                    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                        // Success case
                        resolve(data.candidates[0].content.parts[0].text.trim());
                    } else {
                        // The JSON is valid, but it doesn't contain the translation. It likely contains an error message.
                        console.error('Gemini API returned an error object:', data);
                        const errorMessage = data.error?.message || 'The API response did not contain a valid translation.';
                        reject(`API Error: ${errorMessage}`);
                    }
                },
                onerror: function(response) {
                    // This handles network-level errors (e.g., can't connect to the server)
                    console.error('GM_xmlhttpRequest network error:', response);
                    reject('A network error occurred. Check your internet connection and if the @connect rule is correct.');
                }
            });
        });
    }


    // --- DOM MANIPULATION ---

    function getTextNodes() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let node;
        const textNodes = [];
        const minLength = 5; // Ignore very short text nodes (likely whitespace)

        while ((node = walker.nextNode())) {
            const parent = node.parentNode;
            // Ignore text inside scripts, styles, and non-visible elements
            if (parent.nodeName !== 'SCRIPT' && parent.nodeName !== 'STYLE' &&
                parent.offsetParent !== null && node.nodeValue.trim().length > minLength) {
                textNodes.push(node);
            }
        }
        return textNodes;
    }

    async function startTranslation() {
        const apiKey = await getApiKey();
        if (!apiKey) {
            alert('Translation cancelled. API Key is required.');
            return;
        }

        showOverlay('Translating... (0%)');

        const allTextNodes = getTextNodes();
        if (allTextNodes.length === 0) {
            hideOverlay();
            alert('No translatable text found on the page.');
            return;
        }

        let processedNodes = 0;
        while (processedNodes < allTextNodes.length) {
            let batchNodes = [];
            let batchText = [];
            let currentBatchCharCount = 0;

            // Create a batch based on character limit
            while (processedNodes < allTextNodes.length && currentBatchCharCount < BATCH_CHARACTER_LIMIT) {
                const node = allTextNodes[processedNodes];
                const nodeText = node.nodeValue;
                if (nodeText) {
                    batchNodes.push(node);
                    batchText.push(nodeText);
                    currentBatchCharCount += nodeText.length;
                }
                processedNodes++;
            }

            if (batchNodes.length === 0) continue;

            const separator = '|||---|||';
            const combinedText = batchText.join(separator);

            try {
                const translatedCombinedText = await translateText(combinedText, apiKey);
                const translatedTexts = translatedCombinedText.split(separator);

                if (translatedTexts.length === batchNodes.length) {
                    batchNodes.forEach((node, index) => {
                        node.nodeValue = translatedTexts[index].trim();
                    });
                } else {
                    console.warn('Mismatch between original and translated segment count. Applying translation as a whole to the first node in batch.');
                    batchNodes[0].nodeValue = translatedCombinedText; // Fallback
                }

                const progress = Math.round((processedNodes / allTextNodes.length) * 100);
                showOverlay(`Translating... (${progress}%)`);

            } catch (error) {
                alert(`An error occurred during translation: ${error}`);
                hideOverlay();
                return; // Stop on error
            }
        }

        hideOverlay();
    }

    async function translateSelection() {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (!selectedText) {
            alert('Please select some text to translate first.');
            return;
        }

        const apiKey = await getApiKey();
        if (!apiKey) {
            alert('Translation cancelled. API Key is required.');
            return;
        }

        showOverlay('Translating selection...');

        try {
            const translatedText = await translateText(selectedText, apiKey);

            // Replace the selected text with the translation
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(translatedText));
        } catch (error) {
            alert(`An error occurred during translation: ${error}`);
        } finally {
            hideOverlay();
        }
    }

    // --- SCRIPT INITIALIZATION ---

    // Create the settings panel when the script loads, but keep it hidden.
    createSettingsPanel();

    // --- USERSCRIPT MENU COMMANDS ---
    GM_registerMenuCommand('Configure Translator', toggleSettingsPanel);
    GM_registerMenuCommand('Translate Page to English', startTranslation);
    GM_registerMenuCommand('Translate Selected Text', translateSelection);
    GM_registerMenuCommand('Set Gemini API Key', async () => {
        // Clear the old key before asking for a new one
        await GM_setValue(API_KEY_STORAGE, null);
        await getApiKey();
    });

})();