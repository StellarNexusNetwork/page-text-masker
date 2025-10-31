// ==UserScript==
// @name         页面文本屏蔽器（完整注释版）
// @namespace    https://github.com/StellarNexusNetwork/page-text-masker
// @version      1.5
// @description  屏蔽页面文字（支持模糊/涂抹、strict、长词优先、合并重叠、自动重载/重扫、快捷键），并修复：绝不影响输入控件/可编辑区，启动时清理错误替换的 span。
// @match        *://*/*
// @grant        GM_getResourceText
// @grant        GM_xmlhttpRequest
// @connect      *
// @resource     maskRules file:///C:/Users/YourName/Documents/mask-rules.json
// ==/UserScript==

(function() {
    'use strict';

    /* =====================================================
       🧩 参数区
       ===================================================== */
    const REMOTE_RULES_URL = 'https://blockrules.snnetwork.top';  // 可选的远程规则地址
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

    /* =====================================================
       📦 规则加载（远程、本地、合并）
       ===================================================== */

    // 从远程加载规则
    async function loadFromRemote(url) {
        return new Promise((resolve, reject) => {
            if (!url) return reject('未配置远程链接');
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 5000,
                onload: res => {
                    try { resolve(JSON.parse(res.responseText)); }
                    catch { reject('远程规则解析失败'); }
                },
                onerror: () => reject('远程请求失败'),
                ontimeout: () => reject('远程请求超时')
            });
        });
    }

    // 从本地加载规则（Tampermonkey @resource）
    function loadFromLocal() {
        try {
            const text = GM_getResourceText('maskRules');
            return JSON.parse(text);
        } catch (err) {
            console.error('本地规则加载失败：', err);
            return { keywords: [], regex: [], strict: [] };
        }
    }

    // 统一加载函数：自动合并远程与本地规则
    async function loadRules() {
        let remoteData = { keywords: [], regex: [], strict: [] };
        let localData = { keywords: [], regex: [], strict: [] };

        if (USE_BOTH_RULES) {
            try { remoteData = await loadFromRemote(REMOTE_RULES_URL); } catch {}
            try { localData = loadFromLocal(); } catch {}
        } else {
            try { remoteData = await loadFromRemote(REMOTE_RULES_URL); }
            catch { localData = loadFromLocal(); }
        }

        // 结构解构 + 默认值
        const { keywords: rk = [], regex: rr = [], strict: rs = [] } = remoteData;
        const { keywords: lk = [], regex: lr = [], strict: ls = [] } = localData;

        // 合并两个来源的规则
        const keywords = USE_BOTH_RULES ? rk.concat(lk) : (rk.length ? rk : lk);
        const regex = USE_BOTH_RULES ? rr.concat(lr) : (rr.length ? rr : lr);
        const stricts = USE_BOTH_RULES ? rs.concat(ls) : (rs.length ? rs : ls);

        // 关键词：长词优先，避免“茅台”先匹配掉“飞天茅台”
        const sortedKeywords = [...keywords].sort((a,b) => b.length - a.length);

        // 生成正则对象
        filters = [
            ...sortedKeywords.map(k => new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')),
            ...regex.map(r => new RegExp(r, 'gi'))
        ];
        strictFilters = stricts.map(s => s.trim().toLowerCase());

        console.log(`🎯 已加载 ${filters.length} 条规则 + ${strictFilters.length} 条 strict 规则`);
    }

    /* =====================================================
       🎨 视觉处理（颜色计算与样式）
       ===================================================== */

    // 计算遮盖颜色
    function getMaskColor(el) {
        if (USE_BG_CONTRAST) {
            // 根据背景亮度选择黑或白
            const bg = window.getComputedStyle(el).backgroundColor || 'rgb(255,255,255)';
            const rgb = bg.match(/\d+/g);
            if (!rgb) return '#000000';
            const [r,g,b] = rgb.map(Number);
            const brightness = r*0.299 + g*0.587 + b*0.114;
            return brightness > 128 ? '#000000' : '#ffffff';
        } else {
            // 直接使用文字颜色
            const color = window.getComputedStyle(el).color || 'rgb(0,0,0)';
            const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d\.]+)?\)/);
            if (!m) return '#000000';
            const [r,g,b] = m.slice(1,4).map(Number);
            return `rgb(${r},${g},${b})`;
        }
    }

    // 应用遮盖样式（模糊或涂抹）
    function applyMaskStyle(el) {
        const maskColor = getMaskColor(el);
        if (USE_BLUR) {
            el.style.color = 'transparent';
            el.style.backgroundColor = '';
            el.style.textShadow = `#888 0px 0px ${4 * 1.5}px`;
        } else {
            el.style.color = maskColor;
            el.style.backgroundColor = maskColor;
            el.style.textShadow = '';
        }
        el.style.transition = 'all 0.2s';
        el.style.borderRadius = '2px';
        el.style.cursor = 'help';
    }

    // 清除遮盖（用于 hover 恢复原文）
    function clearMaskStyle(el) {
        el.style.color = '';
        el.style.backgroundColor = '';
        el.style.textShadow = '';
    }

    /* =====================================================
       🔒 安全检测（防止修改输入框/可编辑区）
       ===================================================== */

    // 判断是否表单控件或可编辑区域
    function elementIsFormOrEditable(el) {
        if (!el) return false;
        const tag = (el.tagName || '').toUpperCase();
        if (['INPUT','TEXTAREA','SELECT','OPTION','BUTTON'].includes(tag)) return true;
        if (el.isContentEditable) return true;
        const role = (el.getAttribute('role') || '').toLowerCase();
        if (role.includes('textbox') || role.includes('searchbox')) return true;
        return false;
    }

    // 判断节点是否应跳过（任何祖先是输入控件都跳过）
    function shouldSkipNode(node) {
        let el = node.parentElement;
        while (el) {
            if (elementIsFormOrEditable(el)) return true;
            el = el.parentElement;
        }
        return false;
    }

    // 清理旧版本错误替换的控件
    function cleanupMaskedInsideFormControls() {
        const controls = document.querySelectorAll('input, textarea, select, [contenteditable="true"], [role*="textbox"], [role*="searchbox"]');
        controls.forEach(ctrl => {
            const masked = ctrl.querySelectorAll('.masked-text');
            if (masked.length === 0) return;
            const restored = Array.from(ctrl.childNodes).map(n => n.textContent).join('');
            if (ctrl.tagName === 'INPUT' || ctrl.tagName === 'TEXTAREA') {
                ctrl.value = restored;
                ctrl.textContent = restored;
            } else {
                masked.forEach(s => s.replaceWith(document.createTextNode(s.dataset.original || s.textContent)));
            }
        });
    }

    /* =====================================================
       🔍 文本匹配与替换（合并重叠）
       ===================================================== */

    // 查找所有匹配区间并合并
    function findMatches(text) {
        const matches = [];
        for (const reg of filters) {
            let m;
            reg.lastIndex = 0;
            while ((m = reg.exec(text)) !== null) {
                if (m[0].length === 0) { reg.lastIndex++; continue; }
                matches.push({ start: m.index, end: m.index + m[0].length });
                if (reg.lastIndex === m.index) reg.lastIndex++;
            }
        }
        if (!matches.length) return [];
        matches.sort((a,b) => a.start - b.start);
        const merged = [matches[0]];
        for (let i=1; i<matches.length; i++) {
            const last = merged[merged.length-1];
            const cur = matches[i];
            if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
            else merged.push(cur);
        }
        return merged;
    }

    // 执行替换
    function maskText(root = document.body) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);

        for (const node of nodes) {
            if (shouldSkipNode(node)) continue;
            const text = node.nodeValue;
            if (!text || !text.trim()) continue;

            const cleanText = text.trim().toLowerCase();
            // strict 模式：整句匹配
            if (strictFilters.includes(cleanText)) {
                const span = document.createElement('span');
                span.classList.add('masked-text');
                span.dataset.original = text;
                span.textContent = text;
                node.replaceWith(span);
                continue;
            }

            // 普通匹配
            const regions = findMatches(text);
            if (!regions.length) continue;

            const frag = document.createDocumentFragment();
            let lastIndex = 0;
            for (const {start, end} of regions) {
                if (start > lastIndex)
                    frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
                const span = document.createElement('span');
                span.classList.add('masked-text');
                span.dataset.original = text.slice(start, end);
                span.textContent = text.slice(start, end);
                frag.appendChild(span);
                lastIndex = end;
            }
            if (lastIndex < text.length)
                frag.appendChild(document.createTextNode(text.slice(lastIndex)));

            node.replaceWith(frag);
        }
    }

    /* =====================================================
       🧠 事件与定时器
       ===================================================== */

    // 鼠标悬浮恢复原文
    function attachHoverEvents() {
        document.body.addEventListener('mouseover', e => {
            if (e.target.classList.contains('masked-text')) clearMaskStyle(e.target);
        });
        document.body.addEventListener('mouseout', e => {
            if (e.target.classList.contains('masked-text')) applyMaskStyle(e.target);
        });
    }

    // 自动重载规则并重扫
    async function reloadRulesAndRescan() {
        await loadRules();
        rescanPage();
    }

    // 页面重扫
    function rescanPage() {
        maskText();
        document.querySelectorAll('.masked-text').forEach(applyMaskStyle);
    }

    /* =====================================================
       🚀 初始化入口
       ===================================================== */
    async function init() {
        await loadRules();
        cleanupMaskedInsideFormControls();   // 清理旧错误
        attachHoverEvents();
        rescanPage();

        // 监控 DOM 变化，自动处理新节点
        const observer = new MutationObserver(muts => {
            for (const m of muts) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1) {
                        maskText(node);
                        node.querySelectorAll('.masked-text').forEach(applyMaskStyle);
                    }
                }
            }
        });
        observer.observe(document.body, {childList: true, subtree: true});

        // 快捷键：Shift+B 切换模糊/涂抹，Shift+S 启用/停用脚本
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
                    if (SCRIPT_ENABLED) rescanPage();
                }
            });
        }

        // 定时自动重载与重扫
        setInterval(reloadRulesAndRescan, AUTO_RELOAD_INTERVAL);
        setInterval(rescanPage, AUTO_RESCAN_INTERVAL);
    }

    // 等页面加载完再运行
    window.addEventListener('load', init);
})();
