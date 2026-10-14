const CURRENT_APP_VERSION = "1.4.0";
const STORAGE_KEY = "cipherflux_workspace_data";
const JOURNAL_STORAGE_KEY = "cipherflux_journal_data";

let currentEncryptionKey = null;
let inactivityTimer = null;
const AUTO_LOCK_LIMIT_MS = 5 * 60 * 1000;

const defaultData = {
    version: CURRENT_APP_VERSION,
    boards: [
        {
            id: "board-1",
            title: "Project Alpha Board",
            columns: [
                {
                    id: "todo",
                    title: "To Do",
                    cards: [
                        { id: "c1", title: "Document Name Here", preview: "Insert Text Here...", content: "Insert Text Here." }
                    ]
                },
                {
                    id: "inprogress",
                    title: "In Progress",
                    cards: [
                        { id: "c2", title: "Document Name Here", preview: "Insert Text Here...", content: "Insert Text Here" }
                    ]
                },
                {
                    id: "done",
                    title: "Done",
                    cards: [
                        { id: "c3", title: "Document Name Here", preview: "Insert Text Here.", content: "Insert Text Here." }
                    ]
                }
            ]
        }
    ],
    documents: [
        {
            id: "doc-1",
            title: "Welcome Document",
            preview: "Introduction to your secure documents library...",
            content: "You can create new notes or import markdown/text files right here into your encrypted workspace."
        }
    ]
};

let workspaceData = null;
let currentActiveCardId = null;
let currentActiveDocId = null;

function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    if (!currentEncryptionKey) return;

    inactivityTimer = setTimeout(() => {
        lockAppDueToInactivity();
    }, AUTO_LOCK_LIMIT_MS);
}

function lockAppDueToInactivity() {
    currentEncryptionKey = null;
    workspaceData = null;
    
    document.getElementById('app-screen').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('master-password').value = '';
    
    alert("Auto-Lock Triggered: Your workspace was locked due to 5 minutes of inactivity.");
}

['click', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(eventName => {
    window.addEventListener(eventName, resetInactivityTimer, true);
});

async function getKeyFromPassword(password, saltString = "secure-workspace-salt-key") {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: enc.encode(saltString),
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptData(dataObj, password, saltString = "secure-workspace-salt-key") {
    const jsonString = JSON.stringify(dataObj);
    const enc = new TextEncoder();
    const key = await getKeyFromPassword(password, saltString);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const encryptedContent = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        enc.encode(jsonString)
    );

    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    const encryptedHex = Array.from(new Uint8Array(encryptedContent)).map(b => b.toString(16).padStart(2, '0')).join('');
    
    const cipherPayload = ivHex + ':' + encryptedHex;
    return btoa(cipherPayload);
}

async function decryptData(base64Payload, password, saltString = "secure-workspace-salt-key") {
    try {
        const cipherPayload = atob(base64Payload);
        const parts = cipherPayload.split(':');
        if (parts.length !== 2) throw new Error("Invalid format");

        const ivHex = parts[0];
        const encryptedHex = parts[1];

        const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const encryptedContent = new Uint8Array(encryptedHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const key = await getKeyFromPassword(password, saltString);

        const decryptedContent = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            encryptedContent
        );

        const dec = new TextDecoder();
        return JSON.parse(dec.decode(decryptedContent));
    } catch (error) {
        console.error("Decryption failed:", error);
        return null;
    }
}

function migrateWorkspaceData(oldData) {
    return {
        version: CURRENT_APP_VERSION,
        boards: oldData.boards || defaultData.boards,
        documents: oldData.documents || defaultData.documents
    };
}

async function loadWorkspaceData(password) {
    try {
        const rawFileContent = localStorage.getItem(STORAGE_KEY);
        if (!rawFileContent || rawFileContent.trim() === "") {
            workspaceData = defaultData;
            await saveWorkspaceData();
            return true;
        }

        const decrypted = await decryptData(rawFileContent, password);
        if (decrypted) {
            if (!decrypted.version || decrypted.version !== CURRENT_APP_VERSION) {
                const updateConfirmed = confirm(
                    `App Update Detected!\n\nYour saved workspace is from an older version, but the app has been updated to v${CURRENT_APP_VERSION}.\n\nWould you like to safely migrate your notes to the new version?`
                );

                if (updateConfirmed) {
                    workspaceData = migrateWorkspaceData(decrypted);
                    await saveWorkspaceData();
                } else {
                    workspaceData = decrypted;
                }
            } else {
                workspaceData = decrypted;
            }
            if (!workspaceData.documents) workspaceData.documents = defaultData.documents;
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error("Safe load caught an error:", error);
        workspaceData = defaultData;
        return true;
    }
}

async function saveWorkspaceData() {
    try {
        if (!workspaceData || !currentEncryptionKey) return;
        workspaceData.version = CURRENT_APP_VERSION;
        const securedData = await encryptData(workspaceData, currentEncryptionKey);
        localStorage.setItem(STORAGE_KEY, securedData);
    } catch (error) {
        console.error("Failed to save workspace data:", error);
    }
}

window.handleGlobalSearch = function(query) {
    const q = query.toLowerCase().trim();
    if (q === "") {
        if (document.getElementById('board-view').classList.contains('active')) renderBoard();
        if (document.getElementById('documents-view').classList.contains('active')) renderDocumentsList();
        return;
    }

    const filteredDocs = workspaceData.documents.filter(d => 
        (d.title && d.title.toLowerCase().includes(q)) || 
        (d.content && d.content.toLowerCase().includes(q))
    );

    const docContainer = document.getElementById('docs-items-container');
    docContainer.innerHTML = '';
    filteredDocs.forEach(doc => {
        const itemDiv = document.createElement('div');
        itemDiv.className = `doc-item`;
        itemDiv.onclick = () => {
            switchView('documents');
            openDocument(doc.id);
        };
        itemDiv.innerHTML = `
            <div class="doc-item-title">${doc.title || 'Untitled Document'}</div>
            <div class="doc-item-preview">${doc.preview || 'Match found...'}</div>
        `;
        docContainer.appendChild(itemDiv);
    });
};

window.insertCodeBlock = function(language) {
    const codeHtml = `<pre><code class="language-${language}">// Write your ${language.toUpperCase()} code here...\nconsole.log("Hello Secure World!");</code></pre><p><br></p>`;
    document.execCommand('insertHTML', false, codeHtml);
    if (window.Prism) Prism.highlightAll();
    autoSaveActiveDoc();
};

window.insertCardCodeBlock = function(language) {
    const codeHtml = `<pre><code class="language-${language}">// Write your ${language.toUpperCase()} code here...\nconsole.log("Hello Secure World!");</code></pre><p><br></p>`;
    document.execCommand('insertHTML', false, codeHtml);
    if (window.Prism) Prism.highlightAll();
    autoSaveActiveCard();
};

window.exportVaultBackup = async function() {
    try {
        const backupPackage = {
            exportDate: new Date().toISOString(),
            version: CURRENT_APP_VERSION,
            workspace: localStorage.getItem(STORAGE_KEY) || '',
            journal: localStorage.getItem(JOURNAL_STORAGE_KEY) || ''
        };

        const encryptedBackup = await encryptData(backupPackage, currentEncryptionKey);

        const blob = new Blob([encryptedBackup], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CipherFlux_Backup_${Date.now()}.vaultbak`;
        a.click();
        URL.revokeObjectURL(url);

        alert("Encrypted vault backup package created and downloaded successfully!");
    } catch (err) {
        console.error("Backup failed:", err);
        alert("Failed to generate vault backup.");
    }
};

function renderBoard() {
    try {
        const container = document.getElementById('board-columns-container');
        container.innerHTML = '';

        const board = workspaceData.boards[0];
        document.getElementById('board-header-title').innerText = board.title;

        board.columns.forEach((column, colIndex) => {
            const colDiv = document.createElement('div');
            colDiv.className = 'column';

            let cardsHtml = '';
            column.cards.forEach(card => {
                let moveLeftBtn = colIndex > 0 ? `<button class="card-btn" onclick="moveCard('${card.id}', -1)" title="Move Left">← Move</button>` : '';
                let moveRightBtn = colIndex < board.columns.length - 1 ? `<button class="card-btn" onclick="moveCard('${card.id}', 1)" title="Move Right">Move →</button>` : '';

                cardsHtml += `
                    <div class="card">
                        <div class="card-body" onclick="openCard('${card.id}')">
                            <div class="card-title">${card.title || 'Untitled'}</div>
                            <div class="card-preview">${card.preview || 'No additional preview text...'}</div>
                        </div>
                        <div class="card-actions">
                            <div class="action-group">
                                ${moveLeftBtn}
                                ${moveRightBtn}
                            </div>
                            <button class="card-btn delete" onclick="deleteCard('${card.id}')" title="Delete Card">Delete 🗑️</button>
                        </div>
                    </div>
                `;
            });

            colDiv.innerHTML = `
                <div class="column-header">
                    <span>${column.title}</span>
                    <button class="add-card-btn" onclick="addCardToColumn('${column.id}')">+ Add Card</button>
                </div>
                <div class="card-list">${cardsHtml}</div>
            `;

            container.appendChild(colDiv);
        });
        if (window.Prism) Prism.highlightAll();
    } catch (err) {
        console.error("Render error caught:", err);
    }
}

function renderDocumentsList() {
    const container = document.getElementById('docs-items-container');
    container.innerHTML = '';

    if (!workspaceData.documents) workspaceData.documents = [];

    workspaceData.documents.forEach(doc => {
        const itemDiv = document.createElement('div');
        itemDiv.className = `doc-item ${currentActiveDocId === doc.id ? 'active' : ''}`;
        itemDiv.onclick = () => openDocument(doc.id);
        itemDiv.innerHTML = `
            <div class="doc-item-title">${doc.title || 'Untitled Document'}</div>
            <div class="doc-item-preview">${doc.preview || 'Empty document...'}</div>
        `;
        container.appendChild(itemDiv);
    });
}

window.createNewDocument = function() {
    const newDoc = {
        id: 'doc-' + Date.now(),
        title: 'New Document',
        preview: 'Start writing your document here...',
        content: 'Write your notes, scripts, or documentation here...'
    };

    workspaceData.documents.push(newDoc);
    saveWorkspaceData();
    renderDocumentsList();
    openDocument(newDoc.id);
};

window.openDocument = function(docId) {
    currentActiveDocId = docId;
    renderDocumentsList();

    const targetDoc = workspaceData.documents.find(d => d.id === docId);
    if (targetDoc) {
        document.getElementById('doc-editor-wrapper').style.display = 'flex';
        document.getElementById('doc-active-title').value = targetDoc.title || '';
        document.getElementById('doc-active-content').innerHTML = targetDoc.content || '';
        if (window.Prism) Prism.highlightAll();
    }
};

window.autoSaveActiveDoc = function() {
    if (!currentActiveDocId) return;

    const newTitle = document.getElementById('doc-active-title').value;
    const newContent = document.getElementById('doc-active-content').innerHTML;

    const doc = workspaceData.documents.find(d => d.id === currentActiveDocId);
    if (doc) {
        doc.title = newTitle;
        doc.content = newContent;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newContent;
        doc.preview = tempDiv.textContent.substring(0, 50) + "...";
    }

    saveWorkspaceData();
    renderDocumentsList();

    const statusEl = document.getElementById('doc-save-status');
    statusEl.innerText = "Encrypted & Saved ✓";
    setTimeout(() => {
        statusEl.innerText = "All changes saved locally";
    }, 1500);
};

window.formatDocCommand = function(cmd, val) {
    document.execCommand(cmd, false, val);
    autoSaveActiveDoc();

window.formatDocText = function(command) {
    document.execCommand(command, false, null);
    autoSaveActiveDoc();
};

window.deleteCurrentDocument = function() {
    if (!confirm("Are you sure you want to delete this document?")) return;

    workspaceData.documents = workspaceData.documents.filter(d => d.id !== currentActiveDocId);
    currentActiveDocId = null;
    document.getElementById('doc-editor-wrapper').style.display = 'none';

    saveWorkspaceData();
    renderDocumentsList();
};

window.importDocumentFile = function() {
    document.getElementById('import-file-input').click();
};

window.handleFileImport = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const fileContent = e.target.result;
        const newImportedDoc = {
            id: 'doc-' + Date.now(),
            title: file.name.replace(/\.[^/.]+$/, ""),
            preview: fileContent.substring(0, 50) + "...",
            content: fileContent.replace(/\n/g, '<br>')
        };

        workspaceData.documents.push(newImportedDoc);
        saveWorkspaceData();
        renderDocumentsList();
        openDocument(newImportedDoc.id);
        alert(`Successfully imported "${file.name}" into your Documents library!`);
    };
    reader.readAsText(file);
    event.target.value = '';
};

window.exportCurrentDocument = function() {
    const doc = workspaceData.documents.find(d => d.id === currentActiveDocId);
    if (!doc) return;

    const blob = new Blob([doc.content.replace(/<br>/g, '\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title || 'document'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
};

window.openJournalWindow = function() {
    const journalModal = document.getElementById('journal-modal');
    if (journalModal) {
        journalModal.style.display = 'flex';
    }
};

window.switchView = function(viewName) {
    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
    document.getElementById('editor-view').style.display = 'none';
    document.querySelectorAll('.sidebar-menu a').forEach(a => a.classList.remove('active'));

    if (viewName === 'board') {
        document.getElementById('board-view').classList.add('active');
        document.getElementById('nav-board-link').classList.add('active');
        renderBoard();
    } else if (viewName === 'documents') {
        document.getElementById('documents-view').classList.add('active');
        document.getElementById('nav-docs-link').classList.add('active');
        renderDocumentsList();
    } else if (viewName === 'settings') {
        document.getElementById('settings-view').classList.add('active');
        document.getElementById('nav-settings-link').classList.add('active');
    }
};

window.addCardToColumn = function(columnId) {
    const newCard = {
        id: 'card-' + Date.now(),
        title: 'New Document',
        preview: 'Start writing your notes here...',
        content: 'Write your secure notes or project documentation here...'
    };

    const board = workspaceData.boards[0];
    const column = board.columns.find(col => col.id === columnId);
    if (column) {
        column.cards.push(newCard);
        saveWorkspaceData();
        renderBoard();
        openCard(newCard.id);
    }
};

window.moveCard = function(cardId, direction) {
    const board = workspaceData.boards[0];
    let sourceColIndex = -1;
    let cardIndex = -1;
    let targetCard = null;

    board.columns.forEach((col, cIdx) => {
        const foundIdx = col.cards.findIndex(c => c.id === cardId);
        if (foundIdx !== -1) {
            sourceColIndex = cIdx;
            cardIndex = foundIdx;
            targetCard = col.cards[foundIdx];
        }
    });

    if (sourceColIndex !== -1 && targetCard) {
        const targetColIndex = sourceColIndex + direction;
        if (targetColIndex >= 0 && targetColIndex < board.columns.length) {
            board.columns[sourceColIndex].cards.splice(cardIndex, 1);
            board.columns[targetColIndex].cards.push(targetCard);
            saveWorkspaceData();
            renderBoard();
        }
    }
};

window.deleteCard = function(cardId) {
    if (!confirm("Are you sure you want to delete this document card?")) return;

    const board = workspaceData.boards[0];
    board.columns.forEach(col => {
        col.cards = col.cards.filter(c => c.id !== cardId);
    });

    saveWorkspaceData();
    renderBoard();
};

window.openCard = function(cardId) {
    currentActiveCardId = cardId;
    let targetCard = null;

    workspaceData.boards[0].columns.forEach(col => {
        const found = col.cards.find(c => c.id === cardId);
        if (found) targetCard = found;
    });

    if (targetCard) {
        document.getElementById('active-card-title').value = targetCard.title || '';
        document.getElementById('active-card-content').innerHTML = targetCard.content || '';

        document.getElementById('board-view').classList.remove('active');
        document.getElementById('editor-view').style.display = 'flex';
        if (window.Prism) Prism.highlightAll();
    }
};

window.closeEditor = function() {
    currentActiveCardId = null;
    document.getElementById('editor-view').style.display = 'none';
    document.getElementById('board-view').classList.add('active');
    renderBoard();
};

window.autoSaveActiveCard = function() {
    if (!currentActiveCardId) return;

    const newTitle = document.getElementById('active-card-title').value;
    const newContent = document.getElementById('active-card-content').innerHTML;

    workspaceData.boards[0].columns.forEach(col => {
        const card = col.cards.find(c => c.id === currentActiveCardId);
        if (card) {
            card.title = newTitle;
            card.content = newContent;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newContent;
            card.preview = tempDiv.textContent.substring(0, 50) + "...";
        }
    });

    saveWorkspaceData();
    
    const statusEl = document.getElementById('save-status');
    statusEl.innerText = "Encrypted & Saved ✓";
    setTimeout(() => {
        statusEl.innerText = "All changes saved locally";
    }, 1500);
};

window.formatText = function(command) {
    document.execCommand(command, false, null);
    autoSaveActiveCard();
};

window.unlockApp = async function() {
    const passwordInput = document.getElementById('master-password').value;
    
    if (passwordInput.trim() !== "") {
        if (passwordInput === "/.re-0set./") {
            const confirmReset = confirm("Emergency Reset: This will wipe your old vault storage and create a fresh workspace. Are you sure?");
            if (confirmReset) {
                localStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem(JOURNAL_STORAGE_KEY);
                
                const newPass = prompt("Vault wiped. Enter your NEW master password:");
                if (newPass && newPass.trim() !== "") {
                    currentEncryptionKey = newPass;
                    workspaceData = defaultData;
                    await saveWorkspaceData();
                    renderBoard();
                    document.getElementById('login-screen').style.display = 'none';
                    document.getElementById('app-screen').style.display = 'flex';
                    resetInactivityTimer();
                    alert("New master password set successfully!");
                } else {
                    alert("Reset cancelled. Valid password required.");
                }
            }
            return;
        }

        const isFirstTime = !localStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY).trim() === "";

        if (isFirstTime) {
            const confirmPassword = prompt("First-time setup detected. Please re-enter your new Master Key to confirm:");
            if (confirmPassword !== passwordInput) {
                alert("Passwords do not match. Setup cancelled.");
                return;
            }
        }

        currentEncryptionKey = passwordInput;
        const success = await loadWorkspaceData(passwordInput);
        if (success) {
            if (isFirstTime) {
                alert("Master Key successfully created and workspace initialized!");
            }
            renderBoard();
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-screen').style.display = 'flex';
            resetInactivityTimer();
        } else {
            alert('Incorrect master password or corrupted workspace data!\n\n(Tip: Type `/.re-0set./` to reset your vault if forgotten).');
        }
    } else {
        alert('Please enter a master password!');
    }
};