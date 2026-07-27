let db;
const request = indexedDB.open("AdvancedGameEngineDB", 2);

request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "id" });
    }
};

request.onsuccess = (e) => {
    db = e.target.result;
    initEngine();
};

let currentDirectory = "root"; 
let activeFileId = null;
const editor = document.getElementById('code-editor');

async function initEngine() {
    const tx = db.transaction(["files"], "readwrite");
    const store = tx.objectStore("files");
    
    store.getAll().onsuccess = (e) => {
        if (e.target.result.length === 0) {
            // Начальная структура
            const startFiles = [
                { id: "root", name: "root", type: "folder", parent: null },
                { id: "root/MyGame", name: "MyGame", type: "folder", parent: "root" },
                { id: "root/MyGame/index.html", name: "index.html", type: "file", parent: "root/MyGame", content: "<h1>Моя Игра с Заставкой!</h1>" },
                { id: "root/MyGame/style.css", name: "style.css", type: "file", parent: "root/MyGame", content: "body { background: #111; color: #0f0; text-align: center; padding-top: 20%; }" },
                { id: "root/MyGame/script.js", name: "script.js", type: "file", parent: "root/MyGame", content: "console.log('Игра запущена');" }
            ];
            startFiles.forEach(f => store.add(f));
        }
        renderExplorer();
    };

    editor.addEventListener('input', (e) => {
        if (activeFileId) {
            const tx = db.transaction(["files"], "readwrite");
            const store = tx.objectStore("files");
            store.get(activeFileId).onsuccess = (ev) => {
                let file = ev.target.result;
                if(file) {
                    file.content = e.target.value;
                    let updateTx = db.transaction(["files"], "readwrite");
                    updateTx.objectStore("files").put(file);
                }
            };
        }
    });
}

function renderExplorer() {
    const treeContainer = document.getElementById('file-tree');
    treeContainer.innerHTML = '';
    
    const displayDir = currentDirectory === "root" ? "/" : currentDirectory.replace("root/", "/");
    document.getElementById('current-dir-display').textContent = `📍 Назад [..] (Внутри: ${displayDir})`;

    db.transaction(["files"], "readonly").objectStore("files").getAll().onsuccess = (e) => {
        const items = e.target.result;
        const currentItems = items.filter(item => item.parent === currentDirectory);

        currentItems.forEach(item => {
            const row = document.createElement('div');
            row.className = 'tree-row' + (activeFileId === item.id ? ' selected' : '');

            const title = document.createElement('span');
            title.className = 'tree-item';
            title.textContent = (item.type === 'folder' ? '📁 ' : '📄 ') + item.name;
            
            title.onclick = () => {
                if (item.type === 'folder') {
                    currentDirectory = item.id;
                    renderExplorer();
                } else {
                    openFile(item.id, item.content);
                }
            };
            row.appendChild(title);

            const actions = document.createElement('div');

            if (item.name === "index.html") {
                const runBtn = document.createElement('button');
                runBtn.className = 'action-btn run-btn';
                runBtn.textContent = '▶';
                runBtn.title = 'Запустить игру этой папки';
                runBtn.onclick = () => runGame(item.parent);
                actions.appendChild(runBtn);

                const expBtn = document.createElement('button');
                expBtn.className = 'action-btn export-btn';
                expBtn.textContent = '📦';
                expBtn.title = 'Экспортировать игру';
                expBtn.onclick = () => exportSingleWeb(item.parent);
                actions.appendChild(expBtn);
            }

            const delBtn = document.createElement('button');
            delBtn.className = 'action-btn delete-btn';
            delBtn.textContent = '❌';
            delBtn.onclick = () => deleteItem(item.id, item.type);
            actions.appendChild(delBtn);

            row.appendChild(actions);
            treeContainer.appendChild(row);
        });
    };
}

function goBack() {
    if (currentDirectory === "root") return;
    const parts = currentDirectory.split('/');
    parts.pop();
    currentDirectory = parts.join('/');
    renderExplorer();
}

function openFile(id, content) {
    activeFileId = id;
    document.getElementById('current-file-title').textContent = `Редактируется: ${id.replace('root/', '')}`;
    editor.disabled = false;
    editor.value = content || "";
    renderExplorer();
}

// === КОНЕЦ ПЕРВОЙ ЧАСТИ (ВСТАВЛЯЙ ВТОРУЮ ЧАСТЬ СРАЗУ СЮДА) ===
                                                       function triggerCreateFile() {
    let name = prompt("Имя файла (например, script.js):");
    if (!name) return;
    const id = `${currentDirectory}/${name.trim()}`;
    const tx = db.transaction(["files"], "readwrite");
    tx.objectStore("files").add({ id: id, name: name.trim(), type: "file", parent: currentDirectory, content: "" });
    renderExplorer();
}

function triggerCreateFolder() {
    let name = prompt("Имя папки:");
    if (!name) return;
    const id = `${currentDirectory}/${name.trim()}`;
    const tx = db.transaction(["files"], "readwrite");
    tx.objectStore("files").add({ id: id, name: name.trim(), type: "folder", parent: currentDirectory });
    renderExplorer();
}

// Рекурсивное удаление папки и всего, что внутри нее
function deleteItem(id, type) {
    if (!confirm(`Удалить ${type === 'folder' ? 'папку и все файлы внутри' : 'этот файл'}?`)) return;
    
    const tx = db.transaction(["files"], "readwrite");
    const store = tx.objectStore("files");

    store.getAll().onsuccess = (e) => {
        const allItems = e.target.result;
        
        if (type === 'file') {
            store.delete(id);
            if (activeFileId === id) { editor.value = ""; editor.disabled = true; activeFileId = null; }
        } else {
            // Удаляем саму папку и любые файлы, чей путь начинается с пути этой папки
            allItems.forEach(item => {
                if (item.id === id || item.id.startsWith(id + "/")) {
                    store.delete(item.id);
                }
            });
            if (activeFileId && activeFileId.startsWith(id + "/")) { editor.value = ""; editor.disabled = true; activeFileId = null; }
        }
        setTimeout(renderExplorer, 100);
    };
}

// Сборщик кода игры из конкретной папки
function buildGameCode(folderId, isExport, callback) {
    db.transaction(["files"], "readonly").objectStore("files").getAll().onsuccess = (e) => {
        const files = e.target.result.filter(f => f.id.startsWith(folderId + "/") && f.type === "file");
        const html = files.find(f => f.name === "index.html")?.content || "<h1>index.html пуст</h1>";
        let css = "";
        let js = "";

        files.forEach(f => {
            if (f.name.endsWith('.css')) css += f.content + "\n";
            if (f.name.endsWith('.js')) js += f.content + "\n";
        });

        // Конструктор заставки (Splash Screen), если это ЭКСПОРТ (скачивание игры)
        let splashHTML = "";
        let splashCSS = "";
        let splashJS = "";

        if (isExport) {
            splashHTML = `
                <div id="engine-splash-screen">
                    <div class="splash-logo">⚡ Сделано на HOP-Engine 2.0</div>
                </div>
            `;
            splashCSS = `
                #engine-splash-screen {
                    position: fixed; top:0; left:0; width:100vw; height:100vh;
                    background: #0d0d1a; color: #fff; z-index: 999999;
                    display: flex; align-items: center; justify-content: center;
                    font-family: sans-serif; transition: opacity 0.5s ease;
                }
                .splash-logo {
                    font-size: 28px; font-weight: bold; letter-spacing: 2px;
                    animation: splashPulse 1.5s infinite alternate;
                }
                @keyframes splashPulse {
                    from { transform: scale(0.95); opacity: 0.7; text-shadow: 0 0 10px #00ffff; }
                    to { transform: scale(1.05); opacity: 1; text-shadow: 0 0 20px #00ffff; }
                }
            `;
            splashJS = `
                setTimeout(() => {
                    const splash = document.getElementById("engine-splash-screen");
                    if(splash) {
                        splash.style.opacity = "0";
                        setTimeout(() => splash.remove(), 500);
                    }
                }, 4000);
            `;
        }

        const finalHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    ${css}
                    ${splashCSS}
                </style>
            </head>
            <body>
                ${splashHTML}
                ${html.replace(/<script.*?>.*?<\/script>/gi, '').replace(/<link.*?>/gi, '')}
                <script>
                    ${splashJS}
                    ${js}
                </script>
            </body>
            </html>
        `;
        callback(finalHTML);
    };
}

function runGame(folderId) {
    buildGameCode(folderId, false, (code) => {
        const blob = new Blob([code], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const iframe = document.getElementById('game-preview');
        iframe.src = url;
        iframe.style.display = 'block';

        if (iframe.requestFullscreen) iframe.requestFullscreen();
        else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();

        const exit = () => {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                iframe.style.display = 'none'; iframe.src = '';
            }
        };
        document.addEventListener('fullscreenchange', exit);
        document.addEventListener('webkitfullscreenchange', exit);
    });
}

function exportSingleWeb(folderId) {
    buildGameCode(folderId, true, (code) => {
        const blob = new Blob([code], { type: 'text/html' });
        const a = document.createElement("a");
        const folderName = folderId.split('/').pop();
        a.href = URL.createObjectURL(blob);
        a.download = `${folderName}_game.html`;
        a.click();
    });
}
