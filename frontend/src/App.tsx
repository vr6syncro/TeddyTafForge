import { useEffect, useState } from "react";
import { Button, ConfigProvider, Layout, Segmented, Select, Space, Tabs, Typography, theme } from "antd";
import {
  ThunderboltOutlined,
  HistoryOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  HeartOutlined,
  MoonOutlined,
  SunOutlined,
} from "@ant-design/icons";
import Builder from "./components/Builder";
import ProjectHistory from "./components/ProjectHistory";
import CustomToniesEditor from "./components/CustomToniesEditor";
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
const { Title } = Typography;

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
  const i18nValue = {
    language: uiLanguage,
    setLanguage: setUiLanguage,
    text,
    locale: text.locale,
  };

  return (
    <UiI18nContext.Provider value={i18nValue}>
      <ConfigProvider theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
        <Layout style={{ minHeight: "100vh", background: contentBackground }}>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: headerBackground,
            borderBottom: `1px solid ${headerBorder}`,
            paddingInline: 24,
            height: "auto",
            minHeight: 64,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/logo.png" alt="TafForge" style={{ height: 40, borderRadius: 6 }} />
            <Title level={3} style={{ color: titleColor, margin: 0 }}>
              TafForge
            </Title>
          </div>
          <Space wrap size="middle">
            <Space size={8}>
              <GlobalOutlined style={{ color: titleColor }} />
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
              style={{ color: supportColor }}
            >
              {text.app.support}
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: "24px", maxWidth: 900, margin: "0 auto", width: "100%" }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: "builder",
                label: (
                  <span>
                    <ThunderboltOutlined />
                    {text.app.tabs.builder}
                  </span>
                ),
                children: <Builder uiLanguage={uiLanguage} />,
              },
              {
                key: "history",
                label: (
                  <span>
                    <HistoryOutlined />
                    {text.app.tabs.history}
                  </span>
                ),
                children: <ProjectHistory />,
              },
              {
                key: "custom",
                label: (
                  <span>
                    <DatabaseOutlined />
                    {text.app.tabs.custom}
                  </span>
                ),
                children: <CustomToniesEditor />,
              },
            ]}
          />
        </Content>
        </Layout>
      </ConfigProvider>
    </UiI18nContext.Provider>
  );
};

export default App;
