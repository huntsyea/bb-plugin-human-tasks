// bb-plugin-human-tasks — frontend entry. Registers the Human tasks page, the
// badge icon and alerts, the home screen section, the thread banner, and the
// in-thread form for blocking tasks.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { AlertsController, NavIcon } from "./ui/alerts";
import { HomepageSection } from "./ui/homepage";
import { TasksPage } from "./ui/page";
import { TaskForm } from "./ui/task-form";
import { ThreadBanner } from "./ui/thread-banner";

export default definePluginApp((app) => {
  // The navigation icon carries a live count, so it is the one icon registered with bb.
  app.experimental_icons.register({ name: "human-tasks/nav", component: NavIcon });
  app.slots.experimental_appOverlay({ id: "alerts", component: AlertsController });
  app.slots.navPanel({
    id: "human-tasks",
    title: "Human tasks",
    icon: "human-tasks/nav",
    path: "tasks",
    component: TasksPage,
  });
  app.slots.homepageSection({ id: "waiting", title: "Waiting on you", component: HomepageSection });
  app.slots.pendingInteraction({ id: "task", component: TaskForm });
  app.composer.customize({
    id: "waiting-banner",
    scopes: ["thread"],
    banners: [{ id: "waiting", chrome: "bare", component: ThreadBanner }],
  });
});
