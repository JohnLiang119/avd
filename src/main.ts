import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

// 載入 Vant 繁體中文語系
import { Locale } from 'vant';
import zhTW from 'vant/es/locale/lang/zh-TW';
import 'vant/es/toast/style';
import 'vant/es/dialog/style';

Locale.use('zh-TW', zhTW);

createApp(App).mount('#app')
