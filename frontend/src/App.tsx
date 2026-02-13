import { useState } from "react";
import { Button, ConfigProvider, Layout, Tabs, Typography, theme } from "antd";
import {
  ThunderboltOutlined,
  HistoryOutlined,
  DatabaseOutlined,
  HeartOutlined,
} from "@ant-design/icons";
import Builder from "./components/Builder";
import ProjectHistory from "./components/ProjectHistory";
import CustomToniesEditor from "./components/CustomToniesEditor";

const { Header, Content } = Layout;
const { Title } = Typography;

const App = () => {
  const [activeTab, setActiveTab] = useState("builder");

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <Layout style={{ minHeight: "100vh" }}>
        <Header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/logo.png" alt="TafForge" style={{ height: 40, borderRadius: 6 }} />
            <Title level={3} style={{ color: "#fff", margin: 0 }}>
              TafForge
            </Title>
          </div>
          <Button
            type="link"
            icon={<HeartOutlined />}
            href="https://buymeacoffee.com/vr6syncro"
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: "#ff6b9d" }}
          >
            Support
          </Button>
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
                    Builder
                  </span>
                ),
                children: <Builder />,
              },
              {
                key: "history",
                label: (
                  <span>
                    <HistoryOutlined />
                    Bibliothek
                  </span>
                ),
                children: <ProjectHistory />,
              },
              {
                key: "custom",
                label: (
                  <span>
                    <DatabaseOutlined />
                    Custom Tonies
                  </span>
                ),
                children: <CustomToniesEditor />,
              },
            ]}
          />
        </Content>
      </Layout>
    </ConfigProvider>
  );
};

export default App;
