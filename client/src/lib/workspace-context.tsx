import { createContext, useContext, useState, useEffect } from "react";

type Org = {
  id: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  active: boolean;
  userRole: string;
};

type WorkspaceContextType = {
  currentOrg: Org | null;
  setCurrentOrg: (org: Org) => void;
  organizations: Org[];
  setOrganizations: (orgs: Org[]) => void;
};

const WorkspaceContext = createContext<WorkspaceContextType>({
  currentOrg: null,
  setCurrentOrg: () => {},
  organizations: [],
  setOrganizations: () => {},
});

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [organizations, setOrganizations] = useState<Org[]>([]);
  const [currentOrg, setCurrentOrgState] = useState<Org | null>(null);

  const setCurrentOrg = (org: Org) => {
    setCurrentOrgState(org);
    localStorage.setItem("clubos_workspace", org.slug);
  };

  useEffect(() => {
    if (organizations.length > 0 && !currentOrg) {
      const savedSlug = localStorage.getItem("clubos_workspace");
      const saved = organizations.find(o => o.slug === savedSlug);
      setCurrentOrgState(saved || organizations[0]);
    }
  }, [organizations, currentOrg]);

  return (
    <WorkspaceContext.Provider value={{ currentOrg, setCurrentOrg, organizations, setOrganizations }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
