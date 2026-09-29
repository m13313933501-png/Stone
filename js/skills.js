// 技能/关键词词表（中英文混合）。用于从简历与岗位 JD 中抽取标签。
// 首版用词典法；后续可替换为更细的专业标签体系或接入语义匹配。

export const SKILLS = [
  // 编程语言
  "Python", "Java", "JavaScript", "TypeScript", "C++", "C#", "C", "Go", "Rust", "Swift", "Kotlin", "PHP", "Ruby", "Scala",
  // 前端
  "React", "Vue", "Angular", "前端", "HTML", "CSS", "工程化", "Webpack", "Vite", "可视化",
  // 后端 / 框架
  "Spring", "Django", "Flask", "Node", "Express", "微服务", "分布式", "RESTful", "GraphQL",
  // 数据 / 数据库
  "SQL", "MySQL", "PostgreSQL", "Redis", "MongoDB", "数据库", "数据分析", "数据挖掘", "报表", "数仓",
  // 算法 / AI
  "算法", "数据结构", "机器学习", "深度学习", "TensorFlow", "PyTorch", "自然语言处理", "计算机视觉", "NLP", "CV",
  // 运维 / 云 / 基础
  "Linux", "Docker", "Kubernetes", "云计算", "AWS", "阿里云", "网络", "操作系统", "嵌入式", "硬件", "电路",
  "图形学", "游戏", "游戏引擎", "Unity", "Unreal",
  // 产品 / 运营 / 职能
  "产品", "产品经理", "需求分析", "策划", "创意", "运营", "市场营销", "用户增长", "内容运营",
  "人力资源", "财务", "会计", "金融", "软件工程", "项目管理", "测试", "质量保障",
  // 软技能 / 通用
  "沟通能力", "团队合作", "领导力", "学习能力", "英语", "普通话", "数据分析思维", "逻辑思维",
  // 专业 / 行业
  "计算机", "软件", "电子信息", "通信", "电力系统", "数学", "统计"
];

// 从文本中抽取命中的技能标签（去重、保序）
export function extractSkills(text) {
  if (!text) return [];
  const hit = [];
  const seen = new Set();
  for (const skill of SKILLS) {
    if (seen.has(skill)) continue;
    let matched = false;
    if (/^[A-Za-z0-9+#.]+$/.test(skill)) {
      // 英文/符号技能：按单词边界匹配，避免 "Go" 命中 "Google"
      const re = new RegExp("\\b" + skill.replace(/[.+#]/g, "\\$&") + "\\b", "i");
      matched = re.test(text);
    } else {
      matched = text.includes(skill);
    }
    if (matched) {
      hit.push(skill);
      seen.add(skill);
    }
  }
  return hit;
}
