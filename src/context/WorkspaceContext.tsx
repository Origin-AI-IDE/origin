/* eslint-disable react-refresh/only-export-components -- exports the useWorkspace hook alongside the provider component */
import { createContext, useContext, useState } from "react";

interface WorkspaceContextType {
  folderPath: string | null;
  setFolderPath: (path: string | null) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  folderPath: null,
  setFolderPath: () => {},
});

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [folderPath, setFolderPathState] = useState<string | null>(() =>
    localStorage.getItem("origin-workspace-folder") ?? null
  );

  const setFolderPath = (path: string | null) => {
    setFolderPathState(path);
    if (path) localStorage.setItem("origin-workspace-folder", path);
    else localStorage.removeItem("origin-workspace-folder");
  };

  return (
    <WorkspaceContext.Provider value={{ folderPath, setFolderPath }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
