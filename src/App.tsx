import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import Sidebar from "./components/Sidebar";
import Banner from "./components/Banner";
import NewProfileSheet from "./components/NewProfileSheet";
import SendEvent from "./views/SendEvent";
import ReceiveEvent from "./views/ReceiveEvent";
import Inbox from "./views/Inbox";
import Outbox from "./views/Outbox";
import Configuration from "./views/Configuration";
import { useApp } from "./store";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function App() {
  const { view, toastMsg, title, activeId } = useApp();

  // Reflect member name in the real OS title bar (PRD U8) + browser tab.
  useEffect(() => {
    document.title = `${title} — Standard API Framework`;
    if (isTauri) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().setTitle(`${title} — Standard API Framework`)
      );
    }
  }, [title]);

  return (
    <div className="window">
      <Sidebar />
      <main className="main">
        <Banner />
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
          >
            {view === "send" && <SendEvent key={activeId} />}
            {view === "receive" && <ReceiveEvent key={activeId} />}
            {view === "inbox" && <Inbox key={activeId} />}
            {view === "outbox" && <Outbox key={activeId} />}
            {view === "config" && <Configuration key={activeId} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <NewProfileSheet />

      <AnimatePresence>
        {toastMsg && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: 20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 20, x: "-50%" }}
          >
            <Check />
            <span>{toastMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
