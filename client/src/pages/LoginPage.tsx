import WelcomePreviewPage from "@/pages/WelcomePreviewPage";

/**
 * 保留 /login 老入口，但内容与欢迎页合并。
 * 进入该路由时自动滚到登录面板，避免外部旧链接失效。
 */
export default function LoginPage() {
  return <WelcomePreviewPage autoFocusAuth />;
}
