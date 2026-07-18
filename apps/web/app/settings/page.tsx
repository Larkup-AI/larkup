"use client";

import { useState } from "react";
import { SettingsLayout, type SettingsSection } from "@/components/settings/settings-layout";
import { GeneralSection } from "@/components/settings/general-section";
import { ModelsSection } from "@/components/settings/models-section";
import { ServerSection } from "@/components/settings/server-section";
import { PromptsSection } from "@/components/settings/prompts-section";
import { PlaygroundSection } from "@/components/settings/playground-section";
import { AppearanceSection } from "@/components/settings/appearance-section";
import { StorageSection } from "@/components/settings/storage-section";

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  return (
    <SettingsLayout
      activeSection={activeSection}
      onSectionChange={setActiveSection}
    >
      {activeSection === "general" && <GeneralSection />}
      {activeSection === "models" && <ModelsSection />}
      {activeSection === "storage" && <StorageSection />}
      {activeSection === "server" && <ServerSection />}
      {activeSection === "prompts" && <PromptsSection />}
      {activeSection === "playground" && <PlaygroundSection />}
      {activeSection === "appearance" && <AppearanceSection />}
    </SettingsLayout>
  );
}
