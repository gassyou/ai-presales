/**
 * vue3-mindmap TypeScript shim —— 阶段 7.4i
 *
 * vue3-mindmap@0.5.12 自带的 .d.ts 几乎是 Record<string, unknown>，没法用。
 * 这里手写一份精确的最小类型声明。
 *
 * README props：
 *   v-model      Data[]
 *   x-gap        number   default 84
 *   y-gap        number   default 18
 *   branch       number   default 4
 *   scale-extent [number, number]  default [0.1, 0.8]
 *   timetravel   boolean  default false
 *   drag         boolean  default false
 *   zoom         boolean  default false
 *   edit         boolean  default false
 *   center-btn   boolean  default false
 *   fit-btn      boolean  default false
 *   add-node-btn boolean  default false
 *   download-btn boolean  default false
 *   sharp-corner boolean  default false
 *   ctm          boolean  default false
 *   locale       'zh' | 'en'  default 'zh'
 *
 * Data node: { name: string; children?: Data[]; collapse?: boolean; left?: boolean }
 */
declare module "vue3-mindmap" {
  import type { DefineComponent } from "vue";

  export interface Vue3MindmapData {
    name: string;
    children?: Vue3MindmapData[];
    collapse?: boolean;
    left?: boolean;
  }

  export interface Vue3MindmapProps {
    modelValue: Vue3MindmapData[];
    /** 节点横向间隔 */
    xGap?: number;
    /** 节点纵向间隔 */
    yGap?: number;
    /** 连线宽度 */
    branch?: number;
    /** 缩放范围 [min, max] */
    scaleExtent?: [number, number];
    /** 是否显示撤销重做按钮 */
    timetravel?: boolean;
    /** 节点是否可拖拽 */
    drag?: boolean;
    /** 是否可缩放/拖移 */
    zoom?: boolean;
    /** 是否可编辑 */
    edit?: boolean;
    /** 是否显示居中按钮 */
    centerBtn?: boolean;
    /** 是否显示缩放按钮 */
    fitBtn?: boolean;
    /** 是否显示添加节点按钮 */
    addNodeBtn?: boolean;
    /** 是否显示下载按钮 */
    downloadBtn?: boolean;
    /** 圆角或直角分支 */
    sharpCorner?: boolean;
    /** 是否响应右键菜单 */
    ctm?: boolean;
    /** 语言 */
    locale?: "zh" | "en";
  }

  export interface Vue3MindmapEmits {
    (e: "update:modelValue", value: Vue3MindmapData[]): void;
    /** 点击节点时触发；参数为该节点 data 对象 */
    (e: "click-item", node: Vue3MindmapData): void;
  }

  export const Vue3Mindmap: DefineComponent<
    Vue3MindmapProps,
    Record<string, unknown>,
    unknown,
    Record<string, unknown>,
    Vue3MindmapEmits
  >;

  export default Vue3Mindmap;
}