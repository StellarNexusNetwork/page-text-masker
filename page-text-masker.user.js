// ==UserScript==
// @name         页面文本屏蔽器
// @namespace    https://github.com/StellarNexusNetwork/page-text-masker
// @version      1.0
// @description  根据关键词/正则屏蔽页面文字，支持模糊/涂抹、整句/词模式、背景对比/文字原色、脚本开关、可选择是否启用快捷键、云端/本地规则
// @match        *://*/*
// @grant        GM_getResourceText
// @grant        GM_xmlhttpRequest
// @connect      *
// @resource     maskRules file:///C:/Users/YourName/Documents/mask-rules.json
// ==/UserScript==

(function() {
    'use strict';

    /* ------------------------
       🧩 配置变量说明
    ------------------------ */

    const REMOTE_RULES_URL = '';           // 远程规则JSON URL，可留空
    const AUTO_RELOAD_INTERVAL = 5*60*1000; // 自动重载规则间隔（毫秒）
    const AUTO_RESCAN_INTERVAL = 60*1000;   // 自动扫描页面间隔（毫秒）

    let DEFAULT_BLUR = false;             // 默认是否模糊，true=默认模糊, false=默认涂抹
    let USE_BLUR = DEFAULT_BLUR;          // 当前模糊/涂抹状态，可通过快捷键切换

    let USE_BG_CONTRAST = false;          // true=遮罩颜色根据背景亮度选择黑/白, false=使用文字原色

    let BLUR_LEVEL = 4;                   // text-shadow 模糊基准值
    let BLUR_MULT = 1.5;                  // text-shadow 模糊倍数

    let MASK_WHOLE_SENTENCE = false;      // true=整句屏蔽, false=只屏蔽匹配词

    let SCRIPT_ENABLED = true;            // 脚本功能开关，Shift+S可切换

    let ENABLE_SHORTCUTS = true;          // 是否启用快捷键（Shift+B/Shift+S）

    let USE_BOTH_RULES = true;           // true=同时加载远程和本地规则, false=优先远程/否则本地

    let filters = [];                     // 存放所有关键词和正则规则的数组

    /* ------------------------
       📦 规则加载
    ------------------------ */
    async function loadFromRemote(url) {
        return new Promise((resolve, reject) => {
            if (!url) return reject('未配置远程链接');
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 5000,
                onload: res => {
                    try {
                        const data = JSON.parse(res.responseText);
                        resolve(data);
                    } catch {
                        reject('远程规则解析失败');
                    }
                },
                onerror: () => reject('远程请求失败'),
                ontimeout: () => reject('远程请求超时')
            });
        });
    }

    function loadFromLocal() {
        try {
            const text = GM_getResourceText('maskRules');
            return JSON.parse(text);
        } catch (err) {
            console.error('本地规则加载失败：', err);
            return { keywords: [], regex: [] };
        }
    }

    async function loadRules() {
        let remoteData = { keywords: [], regex: [] };
        let localData = { keywords: [], regex: [] };

        if (USE_BOTH_RULES) {
            try { remoteData = await loadFromRemote(REMOTE_RULES_URL); } catch { console.warn('⚠️ 远程规则加载失败'); }
            try { localData = loadFromLocal(); } catch { console.warn('⚠️ 本地规则加载失败'); }
        } else {
            try {
                remoteData = await loadFromRemote(REMOTE_RULES_URL);
            } catch {
                console.warn('⚠️ 远程规则加载失败，使用本地规则');
                localData = loadFromLocal();
            }
        }

        // 合并规则
        const { keywords: rk = [], regex: rr = [] } = remoteData;
        const { keywords: lk = [], regex: lr = [] } = localData;

        const keywords = USE_BOTH_RULES ? rk.concat(lk) : (rk.length ? rk : lk);
        const regex = USE_BOTH_RULES ? rr.concat(lr) : (rr.length ? rr : lr);

        filters = [
            ...keywords.map(k => new RegExp(k, 'gi')),
            ...regex.map(r => new RegExp(r, 'gi'))
        ];

        console.log(`🎯 已加载 ${filters.length} 条规则 (云端: ${rk.length + rr.length}, 本地: ${lk.length + lr.length})`);
    }

    /* ------------------------
       🎨 遮罩逻辑
    ------------------------ */
    function getMaskColor(el) {
        if (!SCRIPT_ENABLED) return '#000000';
        if (USE_BG_CONTRAST) {
            const bg = window.getComputedStyle(el).backgroundColor || 'rgb(255,255,255)';
            const rgb = bg.match(/\d+/g);
            if (!rgb) return '#000000';
            const [r,g,b] = rgb.map(Number);
            const brightness = r*0.299 + g*0.587 + b*0.114;
            return brightness > 128 ? '#000000' : '#ffffff';
        } else {
            const color = window.getComputedStyle(el).color || 'rgb(0,0,0)';
            const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d\.]+)?\)/);
            if (!m) return '#000000';
            const [r,g,b] = m.slice(1,4).map(Number);
            return `rgb(${r},${g},${b})`;
        }
    }

    function applyMaskStyle(el) {
        if (!SCRIPT_ENABLED) return clearMaskStyle(el);
        const maskColor = getMaskColor(el);

        if (USE_BLUR) {
            el.style.color = 'transparent';
            el.style.backgroundColor = '';
            el.style.textShadow = `#888 0px 0px ${BLUR_LEVEL * BLUR_MULT}px`;
        } else {
            el.style.color = maskColor;
            el.style.backgroundColor = maskColor;
            el.style.textShadow = '';
        }

        el.style.transition = 'all 0.2s';
        el.style.borderRadius = '2px';
        el.style.cursor = 'help';
    }

    function clearMaskStyle(el) {
        el.style.color = '';
        el.style.backgroundColor = '';
        el.style.textShadow = '';
    }

    function maskText(root = document.body) {
        if (!SCRIPT_ENABLED) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);

        for (const node of nodes) {
            const text = node.nodeValue;
            if (!text.trim() || node.parentElement.closest('.masked-text')) continue;

            if (!MASK_WHOLE_SENTENCE) {
                let replaced = text;
                let matched = false;
                for (const reg of filters) {
                    if (reg.test(replaced)) {
                        matched = true;
                        replaced = replaced.replace(reg, (m) =>
                            `<span class="masked-text" data-original="${m}">${m}</span>`
                        );
                    }
                }
                if (matched) {
                    const span = document.createElement('span');
                    span.innerHTML = replaced;
                    node.parentNode.replaceChild(span, node);
                }
            } else {
                let matched = false;
                for (const reg of filters) {
                    if (reg.test(text)) { matched = true; break; }
                }
                if (matched) {
                    const span = document.createElement('span');
                    span.classList.add('masked-text');
                    span.dataset.original = text;
                    span.textContent = text;
                    node.parentNode.replaceChild(span, node);
                }
            }
        }
    }

    function attachHoverEvents() {
        document.body.addEventListener('mouseover', e => {
            if (e.target.classList.contains('masked-text')) clearMaskStyle(e.target);
        });
        document.body.addEventListener('mouseout', e => {
            if (e.target.classList.contains('masked-text')) applyMaskStyle(e.target);
        });
    }

    async function reloadRulesAndRescan() {
        console.log('🔄 自动重载规则与重扫页面中...');
        await loadRules();
        rescanPage();
    }

    function rescanPage() {
        maskText();
        document.querySelectorAll('.masked-text').forEach(applyMaskStyle);
    }

    async function init() {
        await loadRules();
        attachHoverEvents();
        rescanPage();

        const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1) {
                        maskText(node);
                        node.querySelectorAll('.masked-text').forEach(applyMaskStyle);
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        if (ENABLE_SHORTCUTS) {
            window.addEventListener('keydown', e => {
                if (e.shiftKey && e.key.toLowerCase() === 'b') {
                    USE_BLUR = !USE_BLUR;
                    console.log(`🌀 模式切换：${USE_BLUR ? '模糊模式' : '涂抹模式'}`);
                    document.querySelectorAll('.masked-text').forEach(applyMaskStyle);
                }
                if (e.shiftKey && e.key.toLowerCase() === 's') {
                    SCRIPT_ENABLED = !SCRIPT_ENABLED;
                    console.log(`🔔 脚本开关：${SCRIPT_ENABLED ? '开启' : '关闭'}`);
                    document.querySelectorAll('.masked-text').forEach(applyMaskStyle);
                    if (SCRIPT_ENABLED) rescanPage();
                }
            });
        }

        setInterval(reloadRulesAndRescan, AUTO_RELOAD_INTERVAL);
        setInterval(rescanPage, AUTO_RESCAN_INTERVAL);
    }

    window.addEventListener('load', init);
})();
