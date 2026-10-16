/**
 * 本地技能/资质词典（可扩展，全部内置离线）。
 * canonical 为归一后的标准名；synonyms 为它在简历/JD 中的常见写法（统一小写、去空格比较）。
 * 词典只负责“同一技能的不同叫法归并”，不臆测用户具备某项技能。
 */

export interface SkillEntry {
  /** 标准名 */
  canonical: string
  /** 别名（含英文缩写/全称/中文异写），比较时会归一化 */
  synonyms: string[]
  /** 归属维度：skill=硬技能 */
}

export const SKILLS: SkillEntry[] = [
  { canonical: 'JavaScript', synonyms: ['javascript', 'js', 'ecmascript', 'java script'] },
  { canonical: 'TypeScript', synonyms: ['typescript', 'ts'] },
  { canonical: 'Vue', synonyms: ['vue', 'vue.js', 'vuejs', 'vue2', 'vue3', 'vue 2', 'vue 3'] },
  { canonical: 'React', synonyms: ['react', 'react.js', 'reactjs', 'react native', 'reactnative'] },
  { canonical: 'Node.js', synonyms: ['node.js', 'nodejs', 'node', 'node js'] },
  { canonical: 'Python', synonyms: ['python', 'py', 'python3'] },
  { canonical: 'Java', synonyms: ['java', 'j2ee', 'spring boot', 'springboot', 'spring cloud', 'springcloud'] },
  { canonical: 'Go', synonyms: ['go', 'golang', 'go 语言', 'go语言'] },
  { canonical: 'C++', synonyms: ['c++', 'cpp', 'c plus plus'] },
  { canonical: 'C#', synonyms: ['c#', 'c sharp', 'csharp', '.net', 'dotnet', 'asp.net'] },
  { canonical: 'SQL', synonyms: ['sql', 'mysql', 'postgresql', 'postgres', 'oracle', 'sql server', 'tidb', 'clickhouse'] },
  { canonical: 'Redis', synonyms: ['redis', '缓存 redis'] },
  { canonical: 'MongoDB', synonyms: ['mongodb', 'mongo'] },
  { canonical: 'HTML/CSS', synonyms: ['html', 'css', 'html5', 'css3', 'sass', 'less', 'tailwind'] },
  { canonical: '小程序', synonyms: ['小程序', '微信小程序', 'weapp', 'miniprogram', 'uni-app', 'uniapp', 'taro'] },
  { canonical: 'Android', synonyms: ['android', '安卓', 'kotlin', 'jetpack'] },
  { canonical: 'iOS', synonyms: ['ios', 'swift', 'objective-c', 'objectivec', 'iphone 开发'] },
  { canonical: 'Flutter', synonyms: ['flutter', 'dart'] },
  { canonical: 'Docker', synonyms: ['docker', '容器化', 'container'] },
  { canonical: 'Kubernetes', synonyms: ['kubernetes', 'k8s', '容器编排'] },
  { canonical: 'CI/CD', synonyms: ['ci/cd', 'cicd', 'jenkins', 'gitlab ci', '持续集成', '持续部署', '流水线'] },
  { canonical: 'Linux', synonyms: ['linux', 'shell', 'bash', 'centos', 'ubuntu'] },
  { canonical: 'Git', synonyms: ['git', 'github', 'gitlab', '版本控制', 'svn'] },
  { canonical: 'AWS', synonyms: ['aws', '亚马逊云', 'ec2', 's3', 'lambda'] },
  { canonical: '阿里云', synonyms: ['阿里云', 'aliyun', 'oss', 'ecs', 'ack'] },
  { canonical: '腾讯云', synonyms: ['腾讯云', 'tencent cloud', 'cos', 'cvm'] },
  { canonical: '机器学习', synonyms: ['机器学习', 'machine learning', 'ml', 'scikit-learn', 'sklearn'] },
  { canonical: '深度学习', synonyms: ['深度学习', 'deep learning', 'dl', '神经网络', 'pytorch', 'tensorflow'] },
  { canonical: '大模型/LLM', synonyms: ['大模型', 'llm', 'gpt', 'transformer', 'langchain', 'rag', 'agent', '智能体', '提示词工程', 'prompt engineering', 'aigc', '微调', 'fine-tune'] },
  { canonical: 'NLP', synonyms: ['nlp', '自然语言处理', '文本挖掘', '命名实体识别', '情感分析'] },
  { canonical: '计算机视觉', synonyms: ['计算机视觉', 'cv', 'opencv', '图像识别', '目标检测', 'mediapipe'] },
  { canonical: '数据分析', synonyms: ['数据分析', 'data analysis', 'pandas', 'numpy', 'excel', '透视表', '数据看板', 'bi', 'tableau', 'power bi'] },
  { canonical: '数据仓库', synonyms: ['数据仓库', '数仓', 'etl', 'hive', 'spark', 'flink', 'kafka', '大数据'] },
  { canonical: 'UI/UX 设计', synonyms: ['ui', 'ux', 'figma', 'sketch', '交互设计', '用户体验', '原型设计', 'axure'] },
  { canonical: 'Photoshop', synonyms: ['photoshop', 'ps', '平面设计', 'illustrator', 'ai 设计'] },
  { canonical: '视频剪辑', synonyms: ['剪辑', 'premiere', 'pr', 'after effects', 'ae', '剪映', '达芬奇', '短视频制作'] },
  { canonical: 'Office', synonyms: ['office', 'word', 'ppt', 'powerpoint', 'outlook', '办公软件', '文档排版'] },
  { canonical: '财务分析', synonyms: ['财务分析', '做账', '记账', '报税', '成本核算', '预算管理', '财务报表', '用友', '金蝶'] },
  { canonical: 'SEO/SEM', synonyms: ['seo', 'sem', '搜索优化', '关键词投放', '信息流投放', '巨量引擎', 'google ads', '推广运营'] },
  { canonical: '电商运营', synonyms: ['电商运营', '淘宝运营', '天猫', '京东运营', '拼多多', '抖音电商', '直播运营', '选品', '店铺运营'] },
  { canonical: '新媒体运营', synonyms: ['新媒体运营', '公众号', '小红书运营', '内容运营', '文案', '社群运营', '私域运营'] },
  { canonical: '项目管理', synonyms: ['项目管理', 'pmp', '进度管理', '风险管理', '跨部门协作', '敏捷', 'scrum', 'agile'] },
  { canonical: '产品设计', synonyms: ['产品经理', '需求分析', 'prd', '用户调研', '竞品分析', 'roadmap', 'axure', '产品设计'] },
  { canonical: '测试', synonyms: ['测试', 'qa', '自动化测试', 'selenium', 'playwright', 'jest', '压力测试', '性能测试', '用例设计'] },
  { canonical: '销售', synonyms: ['销售', 'to b 销售', '大客户销售', '商务拓展', 'bd', '客户开发', '渠道销售'] },
  { canonical: '英语', synonyms: ['英语', 'english', 'cet-4', 'cet4', 'cet-6', 'cet6', '四级', '六级', '雅思', 'ielts', '托福', 'toefl', '商务英语'] },
  { canonical: '客户服务', synonyms: ['客服', '客户服务', '售后', 'call center', '呼叫中心', '投诉处理'] },
  { canonical: '供应链', synonyms: ['供应链', '采购', '物流', '仓储', '库存管理', 'erp', '供应商管理'] }
]

/** 软性素质/职责词（归入 qual / duty 通道，不要求精确别名） */
export const SOFT_SKILLS: string[] = [
  '沟通能力', '团队协作', '责任心', '抗压能力', '学习能力', '逻辑思维', '执行力',
  '主动性', '客户导向', '问题解决', '组织协调', '表达能力', '跨部门', 'owner 意识',
  'communication', 'teamwork', 'leadership', 'problem solving', 'ownership', 'proactive'
]

/** 职责动作词（用于识别 JD 的职责行并在简历中匹配） */
export const DUTY_VERBS: string[] = [
  '负责', '主导', '参与', '独立完成', '承担', '推动', '搭建', '设计', '开发', '优化',
  '维护', '运营', '策划', '组织', '协调', '管理', '对接', '调研', '分析', '落地',
  'lead', 'responsible', 'develop', 'design', 'build', 'optimize', 'manage', 'deliver', 'own'
]

/** 学历层次（数值越高学历越高），用于硬门槛判定 */
export const DEGREE_LEVELS: Array<{ canonical: string; level: number; patterns: string[] }> = [
  { canonical: '大专', level: 1, patterns: ['大专', '专科', 'associate', 'diploma'] },
  { canonical: '本科', level: 2, patterns: ['本科', '学士', '全日制本科', 'bachelor', 'b.s', 'b.a', 'undergraduate'] },
  { canonical: '硕士', level: 3, patterns: ['硕士', '研究生', 'master', 'm.s', 'm.a', 'mba', 'm.eng'] },
  { canonical: '博士', level: 4, patterns: ['博士', 'phd', 'ph.d', 'doctor'] }
]

/** 常见证书 */
export const CERTS: string[] = [
  'pmp', 'cpa', '注册会计师', '法律职业资格', '司法考试', 'cfa', 'frm', '一级建造师', '二建',
  '教师资格', '执业医师', '护士资格', '人力资源管理师', 'acca', '软考', '系统架构设计师',
  'aws 认证', 'cda', '导游证', '驾驶证'
]

/** 常见中国城市/地点关键词（用于地点硬门槛，命中即比对；不含“异地”类模糊词） */
export const CITY_HINTS: string[] = [
  '北京', '上海', '广州', '深圳', '杭州', '南京', '成都', '武汉', '西安', '苏州', '重庆',
  '天津', '长沙', '郑州', '青岛', '宁波', '厦门', '合肥', '东莞', '佛山', '无锡', '济南',
  '福州', '昆明', '大连', '沈阳', '珠海', '常州', '南昌', '贵阳', '南宁', '哈尔滨', '长春',
  '石家庄', '太原', '兰州', '海口', '三亚', '香港', '澳门', '台北', '远程', '居家办公', '异地'
]

/** 归一化通用停用词（duty/qual 词项匹配时过滤，避免“的/和/工作”这类高频词虚高覆盖率） */
export const STOPWORDS = new Set<string>([
  '的', '了', '和', '与', '及', '或', '等', '在', '有', '是', '为', '能', '可', '我们', '你们', '他们',
  '公司', '岗位', '职位', '工作', '能力', '相关', '优先', '以上', '以下', '熟悉', '了解', '精通',
  '具备', '要求', '负责', '参与', '以及', '进行', '对', '并', '且', '其', '者', '会', '做', '好',
  'the', 'and', 'or', 'for', 'with', 'to', 'of', 'a', 'an', 'in', 'on', 'is', 'are', 'be',
  'you', 'we', 'our', 'your', 'as', 'at', 'by', 'this', 'that', 'it', 'will', 'can'
])
