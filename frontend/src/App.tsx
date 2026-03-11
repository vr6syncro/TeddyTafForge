import { Suspense, lazy, useEffect, useState } from "react";
import { Button, ConfigProvider, Layout, Segmented, Select, Space, Spin, Tabs, Typography, theme } from "antd";
import deDE from "antd/locale/de_DE";
import enGB from "antd/locale/en_GB";
import {
  ThunderboltOutlined,
  HistoryOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  HeartOutlined,
  MoonOutlined,
  SunOutlined,
} from "@ant-design/icons";
import {
  readStoredThemeMode,
  storeThemeMode,
  type ThemeMode,
} from "./appPreferences";
import {
  readStoredUiLanguage,
  storeUiLanguage,
  UiI18nContext,
  UI_LANGUAGE_OPTIONS,
  uiText,
  type UiLanguage,
} from "./uiI18n";

const { Header, Content } = Layout;
const { Title, Text } = Typography;
const Builder = lazy(() => import("./components/Builder"));
const ProjectHistory = lazy(() => import("./components/ProjectHistory"));
const CustomToniesEditor = lazy(() => import("./components/CustomToniesEditor"));

const App = () => {
  const [activeTab, setActiveTab] = useState("builder");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredThemeMode());
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(() => readStoredUiLanguage());

  useEffect(() => {
    storeThemeMode(themeMode);
    document.documentElement.style.colorScheme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    storeUiLanguage(uiLanguage);
  }, [uiLanguage]);

  const isDark = themeMode === "dark";
  const text = uiText[uiLanguage];
  const headerBackground = isDark ? "#141414" : "#ffffff";
  const headerBorder = isDark ? "#303030" : "#d9d9d9";
  const contentBackground = isDark ? "#0f1115" : "#f5f7fa";
  const titleColor = isDark ? "#ffffff" : "#111827";
  const supportColor = isDark ? "#ff8cb2" : "#b4235a";
  const activeContent = (() => {
    if (activeTab === "history") {
      return <ProjectHistory />;
    }
    if (activeTab === "custom") {
      return <CustomToniesEditor />;
    }
    return <Builder uiLanguage={uiLanguage} />;
  })();
  const antdLocale = uiLanguage === "en" ? enGB : deDE;
  const i18nValue = {
    language: uiLanguage,
    setLanguage: setUiLanguage,
    text,
    locale: text.locale,
  };

  return (
    <UiI18nContext.Provider value={i18nValue}>
      <ConfigProvider
        locale={antdLocale}
        theme={{
          algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            borderRadius: 12,
            colorPrimary: isDark ? "#7dd3a7" : "#0f7b53",
          },
        }}
      >
        <Layout style={{ minHeight: "100vh", background: contentBackground }}>
          <Header
            style={{
              background: headerBackground,
              borderBottom: `1px solid ${headerBorder}`,
              padding: "16px 20px",
              height: "auto",
            }}
          >
            <div
              style={{
                maxWidth: 1240,
                margin: "0 auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: "1 1 320px" }}>
                <img src="/logo.png" alt="TafForge" style={{ height: 44, borderRadius: 8, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <Title level={3} style={{ color: titleColor, margin: 0, lineHeight: 1.1 }}>
                    TafForge
                  </Title>
                  <Text style={{ color: isDark ? "#9ca3af" : "#4b5563" }}>
                    {text.app.subtitle}
                  </Text>
                </div>
              </div>
              <Space wrap size="middle" style={{ justifyContent: "flex-end" }}>
                <Space size={8}>
                  <GlobalOutlined style={{ color: titleColor }} />
                  <Text style={{ color: titleColor }}>{text.app.languageLabel}</Text>
                  <Select
                    size="small"
                    value={uiLanguage}
                    options={UI_LANGUAGE_OPTIONS}
                    onChange={(value) => setUiLanguage(value as UiLanguage)}
                    popupMatchSelectWidth={false}
                    style={{ width: 132 }}
                  />
                </Space>
                <Segmented
                  size="small"
                  value={themeMode}
                  onChange={(value) => setThemeMode(value as ThemeMode)}
                  options={[
                    { value: "light", icon: <SunOutlined />, label: text.app.theme.light },
                    { value: "dark", icon: <MoonOutlined />, label: text.app.theme.dark },
                  ]}
                />
                <Button
                  type="link"
                  icon={<HeartOutlined />}
                  href="https://buymeacoffee.com/vr6syncro"
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{ color: supportColor, paddingInline: 0 }}
                >
                  {text.app.support}
                </Button>
              </Space>
            </div>
          </Header>
          <Content style={{ padding: "24px 16px 32px", maxWidth: 1240, margin: "0 auto", width: "100%" }}>
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              tabBarGutter={24}
              items={[
                {
                  key: "builder",
                  label: (
                    <span>
                      <ThunderboltOutlined />
                      {text.app.tabs.builder}
                    </span>
                  ),
                },
                {
                  key: "history",
                  label: (
                    <span>
                      <HistoryOutlined />
                      {text.app.tabs.history}
                    </span>
                  ),
                },
                {
                  key: "custom",
                  label: (
                    <span>
                      <DatabaseOutlined />
                      {text.app.tabs.custom}
                    </span>
                  ),
                },
              ]}
            />
            <Suspense
              fallback={
                <Space direction="vertical" size="middle" style={{ width: "100%", alignItems: "center", padding: "48px 0" }}>
                  <Spin size="large" />
                  <Text type="secondary">{text.app.loading}</Text>
                </Space>
              }
            >
              {activeContent}
            </Suspense>
          </Content>
        </Layout>
      </ConfigProvider>
    </UiI18nContext.Provider>
  );
};

export default App;
