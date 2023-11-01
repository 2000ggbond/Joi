import useLCUStore, { ConnectStatusEnum, GameFlowPhase } from "@/store/lcu";
import { lcuConst } from "@@/const/const";
import router from "@/router";
import IpcRendererEvent = Electron.IpcRendererEvent;

export function setupListener() {
  const lcuStore = useLCUStore();
  window.ipcRenderer.on(
    lcuConst.disconnect,
    (event: IpcRendererEvent, ...args: any[]) => {
      lcuStore.connectStatus = ConnectStatusEnum.disconnect;
    },
  );
  window.ipcRenderer.on(
    lcuConst.connecting,
    (event: IpcRendererEvent, ...args: any[]) => {
      lcuStore.connectStatus = ConnectStatusEnum.connecting;
    },
  );
  window.ipcRenderer.on(
    lcuConst.connected,
    (event: IpcRendererEvent, ...args: any[]) => {
      lcuStore.connectStatus = ConnectStatusEnum.connected;
      void lcuStore.getCurrentSummoner();
    },
  );
  window.ipcRenderer.on(
    "jumpRoute",
    (event: IpcRendererEvent, ...args: any[]) => {
      void router.push(args[0] as string | { name: string });
    },
  );
  window.ipcRenderer.on(
    lcuConst.gameFlowPhase,
    (event: IpcRendererEvent, phase: GameFlowPhase) => {
      console.log("gameFlowPhase", phase);
      if (phase === "Matchmaking") {
        lcuStore.updateChampId(0);
      }
      lcuStore.gameFlowPhase = phase;
    },
  );
  window.ipcRenderer.on(
    lcuConst.champSelect,
    (event: IpcRendererEvent, champId: number) => {
      console.log("champSelect", champId);
      lcuStore.updateChampId(champId);
    },
  );
}
