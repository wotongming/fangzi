import type { ToolManifest } from '@/core/types'

export const manifest: ToolManifest = {
  id: 'wc-workbench',
  name: '跨框架组件库工作台',
  tagline: '浏览器内可视化定义属性 / 事件 / 插槽 / 主题，一次建模同时生成原生 Web Component 与 Lit 组件、React / Vue 适配、API 文档和 custom-elements.json，实时预览并一键打包 npm 包；写一次，React、Vue、Angular、老 jQuery 系统到处用，告别三套组件库重复维护。',
  category: 'developer',
  type: 'web',
  targetUsers: ['设计系统 / 组件库工程师', '前端架构师', '独立开发者 / 自由职业', '微前端团队', '需要同时维护多技术栈的中大型团队'],
  scenarios: [
    '公司内 React、Vue、老 jQuery 系统并存，想“写一次组件到处用”，不再为每个框架各维护一套组件库',
    '设计系统负责人改一个设计 token / 组件行为，希望只改一份 Web Component 就同步到所有技术栈',
    '组件库作者需要自动产出 API 文档、交互演示页与 custom-elements.json，给 VS Code 提供标签补全',
    '微前端子应用框架不同，需要一个框架无关的共享组件层，避免 Module Federation 的运行时协商',
    '独立开发者想把同一交互组件交付给用不同技术栈的客户站点，零依赖、复制 script 即用'
  ],
  painPoints: [
    '同一套 UI 要为 React / Vue / Angular 分别实现，重复开发、改一处要同步三处',
    '原生 Web Components API 繁琐、缺脚手架，property/attribute 反射、CustomEvent、Shadow DOM 样板代码多',
    '组件文档、演示、custom-elements.json、跨框架 wrapper 全靠手写，维护成本高',
    '通用前端工具红海且偏框架组件，缺少面向 Web Components 全生命周期的一体化工作台'
  ],
  keywords: [
    'web components', 'web component', '自定义元素', 'custom element', 'customelements',
    '跨框架组件', '跨框架', '组件库', '设计系统', '组件生成', '组件脚手架',
    'lit', 'litelement', 'shadow dom', 'custom-elements.json', 'custom elements manifest',
    'react 组件', 'vue 组件', 'angular 组件', 'wrapper', '组件包装', '微前端',
    'design system', 'component library', '跨端组件', '框架无关', '前端组件',
    'api 文档生成', 'npm 包', '组件打包', 'publish', '前端开发工具'
  ],
  billing: {
    mode: 'freemium',
    currency: 'CNY',
    priceCents: 4990,
    features: [
      { key: 'native-gen', label: '原生 Web Component 生成、实时预览、属性/事件/插槽/主题建模', free: true },
      { key: 'docs-manifest', label: 'API 文档、交互演示页、custom-elements.json、单文件 / 最小可用包导出', free: true },
      { key: 'library-3', label: '本地组件库（最多 3 个）与模型导入导出', free: true },
      { key: 'lit-gen', label: 'Lit 3 + TypeScript 组件源码生成', free: false },
      { key: 'wrappers', label: 'React / Vue 跨框架 wrapper 批量生成', free: false },
      { key: 'npm-zip', label: '完整 npm 包结构一键打包、不限本地组件数量', free: false }
    ]
  },
  createdAt: '2026-10-15',
  updatedAt: '2026-10-15',
  version: '1.0.0',
  status: 'stable',
  author: 'fangzi'
}
