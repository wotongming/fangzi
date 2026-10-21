# 架构 · 006 求职管线与简历穿透（重构 resume-jd-matcher，待编码）
复用 resume-jd-matcher 解析链路（pdfjs/mammoth）与 IDB `fz-resume-jd-v1`。新增 `lib/ats-check.ts`：基于 pdf.js 文本块 x 坐标判多栏、提取文本过短判图片型简历、联系方式正则命中、JD 关键词密度；投递看板补转化率漏斗。存量记录结构不变，新字段可选。
