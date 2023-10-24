import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import { createPinia } from "pinia";
import { ElMessage } from "element-plus";
import "element-plus/theme-chalk/el-message.css";
import { setupListener } from "@/listener/backgroundListener";
import router from "@/router/index";
import LazyLoad from "lazy-load-vue3";
import useLCUStore from "@/store/lcu";
import "@morev/vue-transitions/styles";

const app = createApp(App);
const pinia = createPinia();
app.use(router);
app.use(pinia);
app.mount("#app").$nextTick(() => {
  postMessage({ payload: "removeLoading" }, "*");
});
await setupListener();

app.use(LazyLoad, { component: true });
app.config.errorHandler = (err, vm, info) => {
  // 处理错误
  // `info` 是 Vue 特定的错误信息，比如错误所在的生命周期钩子
  console.error("[errorCaptured]", err, vm, info);
  if (err instanceof Error) {
    ElMessage.error(err.message);
  }
};
window.onload = () => {
  //解决开发模式重载网页时状态不同步
  useLCUStore().refreshConnectStatus();
};
