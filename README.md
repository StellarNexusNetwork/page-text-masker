# ⚠️ 注意！使用风险提示

- 本脚本由 **AI 生成**，可能存在未知 bug  
- 可能 **影响浏览器性能或导致页面卡顿**  
- 请自行备份重要数据后使用  
- 本地 JSON 文件或远程规则文件修改后，可能需要刷新页面或等待脚本重新加载才能生效  
- 使用时请自行承担风险  

---

# 页面文本屏蔽器（Page Text Masker）

[点击安装](https://raw.githubusercontent.com/StellarNexusNetwork/page-text-masker/refs/heads/main/page-text-masker.user.js)

---

## ⚡ 脚本功能

- 根据 **关键词** 或 **正则表达式** 屏蔽网页文字  
- 支持：
  - 模糊 / 涂抹效果  
  - 整句 / 单词模式  
  - 背景对比色 / 文字原色  
  - 快捷键开关  
  - 云端 / 本地规则 JSON  
- 可定时重载规则  

---

## 🛠️ 安装方式

1. 安装 **Tampermonkey** 或 **Violentmonkey** 扩展：
   - [Tampermonkey Chrome 扩展商店](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)  
   - [Violentmonkey Chrome 扩展商店](https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag)  
2. 点击上方“点击安装”链接  
3. 脚本会在所有网页生效（`@match *://*/*`）  

---

## ⌨️ 快捷键

- `Shift + B` → 切换模糊模式  
- `Shift + S` → 开关功能
- 其他可通过脚本内部配置或修改  

---

## 📦 规则 JSON

- **本地规则示例**：
```json
{
  "keywords": ["好主意","屏蔽器","页面"],
  "regex": ["猫+","(\\d{4}-\\d{2}-\\d{2})"]
}

---

## 🌐 默认远程规则

- 默认云端规则地址（可在脚本中修改）：[blockrules.snnetwork.top](https://blockrules.snnetwork.top/)
