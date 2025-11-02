// ==UserScript==
// @name         页面文本屏蔽器
// @namespace    https://github.com/StellarNexusNetwork/page-text-masker
// @version      1.3.1
// @description  根据关键词/正则屏蔽页面文字，支持模糊/涂抹、整句/词模式、背景对比/文字原色、脚本开关、可选择是否启用快捷键、云端/本地/严格规则。
// @match        *://*/*
// @grant        GM_getResourceText
// @grant        GM_xmlhttpRequest
// @connect      *
// @resource     maskRules file:///C:/Users/YourName/Documents/mask-rules.json
// ==/UserScript==

(function() {
    'use strict';

    const REMOTE_RULES_URL = 'https://blockrules.snnetwork.top/block-rules.json';  // 可选的远程规则地址
    const AUTO_RELOAD_INTERVAL = 5*60*1000; // 每 5 分钟重载规则
    const AUTO_RESCAN_INTERVAL = 60*1000;   // 每 1 分钟重扫页面

    // 可调开关与选项
    let DEFAULT_BLUR = false;      // 默认是否模糊
    let USE_BLUR = DEFAULT_BLUR;   // 当前模糊开关
    let USE_BG_CONTRAST = false;   // 是否根据背景亮度选择遮盖颜色
    let BLUR_LEVEL = 4;            // 模糊半径
    let BLUR_MULT = 1.5;           // 模糊强度倍率
    let MASK_WHOLE_SENTENCE = false; // 是否整句屏蔽
    let SCRIPT_ENABLED = true;     // 总开关
    let ENABLE_SHORTCUTS = true;   // 是否启用快捷键
    let USE_BOTH_RULES = true;     // 同时加载本地+远程规则

    // 规则缓存
    let filters = [];        // 普通关键词 / 正则
    let strictFilters = [];  // strict 模式词汇（整句匹配）

/* ------------------------
   📦 规则加载
------------------------ */
async function loadFromRemote(url) {
    return new Promise((resolve, reject) => {
        if (!url) return reject(new Error('未配置远程链接'));
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            timeout: 5000,
            onload: res => {
                if (res.status !== 200) {
                    return reject(new Error(`HTTP ${res.status} ${res.statusText || ''}`));
                }
                try {
                    const data = JSON.parse(res.responseText);
                    resolve(data);
                } catch (err) {
                    reject(new Error(`远程规则解析失败：${err.message}`));
                }
            },
            onerror: err => reject(new Error(`远程请求错误：${err.error || err.message || '未知错误'}`)),
            ontimeout: () => reject(new Error('远程请求超时（超过5秒未响应）'))
        });
    });
}

async function loadRules() {
    let remoteData = { keywords: [], regex: [], strict: [] };
    let localData = { keywords: [], regex: [], strict: [] };

    if (USE_BOTH_RULES) {
        try {
            remoteData = await loadFromRemote(REMOTE_RULES_URL);
        } catch (err) {
            console.warn(`⚠️ 远程规则加载失败：${err.message}`);
        }
        try {
            localData = loadFromLocal();
        } catch (err) {
            console.warn(`⚠️ 本地规则加载失败：${err.message}`);
        }
    } else {
        try {
            remoteData = await loadFromRemote(REMOTE_RULES_URL);
        } catch (err) {
            console.warn(`⚠️ 远程规则加载失败：${err.message}，使用本地规则`);
            localData = loadFromLocal();
        }
    }

    const { keywords: rk = [], regex: rr = [], strict: rs = [] } = remoteData;
    const { keywords: lk = [], regex: lr = [], strict: ls = [] } = localData;

    const keywords = USE_BOTH_RULES ? rk.concat(lk) : (rk.length ? rk : lk);
    const regex = USE_BOTH_RULES ? rr.concat(lr) : (rr.length ? rr : lr);
    const stricts = USE_BOTH_RULES ? rs.concat(ls) : (rs.length ? rs : ls);

    const sortedKeywords = [...keywords].sort((a, b) => b.length - a.length);

    filters = [
        ...sortedKeywords.map(k => new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')),
        ...regex.map(r => new RegExp(r, 'gi'))
    ];

    strictFilters = stricts.map(s => s.trim().toLowerCase());

    console.log(`🎯 已加载 ${filters.length} 条规则 + ${strictFilters.length} 条 strict 规则`);
}

    /* ------------------------
       🎨 样式函数
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

    /* ------------------------
       🔍 改进的匹配算法（合并重叠）
    ------------------------ */
    function findMatches(text) {
        const matches = [];

        for (const reg of filters) {
            let m;
            while ((m = reg.exec(text)) !== null) {
                matches.push({ start: m.index, end: m.index + m[0].length });
            }
        }

        if (matches.length === 0) return [];

        // 合并重叠范围
        matches.sort((a, b) => a.start - b.start);
        const merged = [matches[0]];
        for (let i = 1; i < matches.length; i++) {
            const last = merged[merged.length - 1];
            const cur = matches[i];
            if (cur.start <= last.end) {
                last.end = Math.max(last.end, cur.end);
            } else {
                merged.push(cur);
            }
        }
        return merged;
    }

    function maskText(root = document.body) {
        if (!SCRIPT_ENABLED) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);

        for (const node of nodes) {
            const text = node.nodeValue;
            if (!text.trim() || node.parentElement.closest('.masked-text')) continue;

            const cleanText = text.trim().toLowerCase();

            if (strictFilters.includes(cleanText)) {
                const span = document.createElement('span');
                span.classList.add('masked-text');
                span.dataset.original = text;
                span.textContent = text;
                node.parentNode.replaceChild(span, node);
                continue;
            }

            const regions = findMatches(text);
            if (regions.length === 0) continue;

            const frag = document.createDocumentFragment();
            let lastIndex = 0;
            for (const { start, end } of regions) {
                if (start > lastIndex) {
                    frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
                }
                const span = document.createElement('span');
                span.classList.add('masked-text');
                span.dataset.original = text.slice(start, end);
                span.textContent = text.slice(start, end);
                frag.appendChild(span);
                lastIndex = end;
            }
            if (lastIndex < text.length) {
                frag.appendChild(document.createTextNode(text.slice(lastIndex)));
            }
            node.parentNode.replaceChild(frag, node);
        }
    }

    /* ------------------------
       🧩 初始化与事件
    ------------------------ */
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
