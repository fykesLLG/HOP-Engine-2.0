// Инициализация базы данных IndexedDB через библиотеку Dexie
const db = new Dexie("GameEngineDB");

// Создаем таблицу файлов. Путь (id) — уникальный ключ (например: "root/js/player.js")
db.version(1).stores({
    files: 'id, name, type, parent, content'
});

let currentDirectory = "root";
let activeFileId = null;
const editor = document.getElementById('code-editor');

// При запуске проверяем базу данных. Если она пуста, создаем стартовый шаблон.
async function initEngine() {
    const count = await db.files.count();
    if (count === 0) {
        await db.files.bulkAdd([
            { id: "root", name: "root", type: "folder", parent: null, content: "" },
            { id: "root/index.html", name: "index.html", type: "file", parent: "root", content: "<h1>Моя Игра</h1>\n<link rel='stylesheet' href='style.css'>\n<script src='script.js'></" + "script>" },
            { id: "root/style.css", name: "style.css", type: "file", parent: "root", content: "body {\n    background: #222;\n    color: #fff;\n    text-align: center;\n    padding-top: 20%;\n}" },
            { id: "root/script.js", name: "script.js", type: "file", parent: "root", content: "console.log('Движок инициализировал скрипт!');" }
        ]);
    }
    
    // Вешаем событие автосохранения изменений в IndexedDB при вводе текста
    editor.addEventListener('input', async (e) => {
        if (activeFileId) {
            await db.files.update(activeFileId, { content: e.target.value });
        }
    });

    renderExplorer();
}

// Отображение структуры папок и файлов
async function renderExplorer() {
    const treeContainer = document.getElementById('file-tree');
    treeContainer.innerHTML = '';
    
    document.getElementById('current-dir-display').textContent = `Текущая папка: ${currentDirectory.replace('root', '') || '/'}`;

    // Получаем все элементы из базы данных IndexedDB
    const allItems = await db.files.toArray();
    
    // Сортируем: сначала папки, затем файлы
    allItems.sort((a, b) => (b.type === 'folder') - (a.type === 'folder') || a.name.localeCompare(b.name));

    allItems.forEach(item => {
        if (item.id === "root") return; // Корень не отрисовываем как элемент списка

        const div = document.createElement('div');
        div.className = `tree-item ${item.type}-item`;
        if (activeFileId === item.id) div.classList.add('selected');
        
        div.textContent = (item.type === 'folder' ? '📁 ' : '📄 ') + item.name;

        div.onclick = () => {
            if (item.type === 'folder') {
                currentDirectory = item.id;
                renderExplorer();
            } else {
                openFile(item.id, item.name, item.content);
            }
        };

        treeContainer.appendChild(div);
    });
}

// Открытие файла в редакторе
function openFile(id, name, content) {
    activeFileId = id;
    document.getElementById('current-file-title').textContent = `Редактируется: ${id.replace('root/', '')}`;
    editor.disabled = false;
    editor.value = content;
    
    // Перерендерим дерево, чтобы обновить подсветку активного файла
    renderExplorer();
}

// Создание папки
async function triggerCreateFolder() {
    const name = prompt("Введите название папки:");
    if (!name || name.trim() === "") return;
    
    const id = `${currentDirectory}/${name.trim()}`;
    const exists = await db.files.get(id);
    if (exists) return alert("Такой элемент уже существует!");

    await db.files.add({
        id: id,
        name: name.trim(),
        type: "folder",
        parent: currentDirectory,
        content: ""
    });
    renderExplorer();
}

// Создание файла (неограниченно)
async function triggerCreateFile() {
    const name = prompt("Введите имя файла (например: player.js, level.css):");
    if (!name || name.trim() === "") return;

    const id = `${currentDirectory}/${name.trim()}`;
    const exists = await db.files.get(id);
    if (exists) return alert("Такой элемент уже существует!");

    await db.files.add({
        id: id,
        name: name.trim(),
        type: "file",
        parent: currentDirectory,
        content: ""
    });
    renderExplorer();
    openFile(id, name.trim(), "");
}

// ▶ ЗАПУСК ИГРЫ (Динамическая склейка неограниченного числа файлов)
async function runGame() {
    const files = await db.files.where({ type: "file" }).toArray();
    
    const htmlFile = files.find(f => f.id === "root/index.html");
    if (!htmlFile) return alert("Файл root/index.html не найден! Он обязателен для запуска.");

    let htmlContent = htmlFile.content;

    // Автоматически ищем все остальные CSS и JS файлы проекта и внедряем их содержимое внутрь HTML
    let cssInjections = "";
    let jsInjections = "";

    files.forEach(file => {
        if (file.id.endsWith('.css')) {
            cssInjections += `/* --- ${file.name} --- */\n${file.content}\n`;
        } else if (file.id.endsWith('.js') && file.id !== "root/script.js") {
            // Скрипты, кроме основного, склеиваем по очереди
            jsInjections += `// --- ${file.name} ---\n${file.content}\n`;
        }
    });

    const mainJs = files.find(f => f.id === "root/script.js");
    if (mainJs) jsInjections += `\n// --- main script.js ---\n${mainJs.content}`;

    // Очищаем оригинальные теги вызова внешних файлов, чтобы избежать ошибок 404 в Blob, и внедряем собранный код
    let finalCode = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>${cssInjections}</style>
        </head>
        <body>
            ${htmlContent.replace(/<script.*?>.*?<\/script>/gi, '').replace(/<link.*?>/gi, '')}
            <script>${jsInjections}<\/script>
        </body>
        </html>
    `;

    const blob = new Blob([finalCode], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);
    
    const iframe = document.getElementById('game-preview');
    iframe.src = blobUrl;
    iframe.style.display = 'block';

    // Запуск HTML5 Fullscreen API
    if (iframe.requestFullscreen) iframe.requestFullscreen();
    else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();

    // Следим за закрытием полноэкранного режима
    const exitHandler = () => {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            iframe.style.display = 'none';
            iframe.src = '';
            document.removeEventListener('fullscreenchange', exitHandler);
            document.removeEventListener('webkitfullscreenchange', exitHandler);
        }
    };
    document.addEventListener('fullscreenchange', exitHandler);
    document.addEventListener('webkitfullscreenchange', exitHandler);
}

// 📦 ЭКСПОРТ ВСЕЙ СТРУКТУРЫ ПРОЕКТА В .ZIP
async function exportWeb() {
    const zip = new JSZip();
    const allItems = await db.files.toArray();
    
    // Проходим по сохраненной иерархии и восстанавливаем её внутри архива
    allItems.forEach(item => {
        if (item.id === "root") return;
        
        // Убираем префикс "root/" для чистого экспорта
        const relativePath = item.id.replace('root/', '');
        
        if (item.type === 'folder') {
            zip.folder(relativePath);
        } else {
            zip.file(relativePath, item.content);
        }
    });

    // Генерация ZIP и скачивание пользователю
    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = "html5_project_export.zip";
    link.click();
}

// Запуск инициализации при загрузке страницы
window.onload = initEngine;
