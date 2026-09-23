/**
 * Vue 应用入口
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import { router } from "./router.ts";
import App from "./App.vue";
import "./styles.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");