import {
  useCerbos,
  type PlanResourcesRequestInput,
} from "@/components/CerbosContext";
import { RpcScreen } from "@/components/demo/RpcScreen";

const defaultRequest: PlanResourcesRequestInput = {
  principal: {
    id: "alice",
    roles: ["USER"],
    attr: { department: "IT" },
  },
  resource: {
    kind: "resource",
  },
  action: "update",
  includeMetadata: true,
};

/** The response is always allowed, always denied, or a condition to filter a list by. */
export default function PlanResourcesScreen() {
  const { planResources } = useCerbos();

  return (
    <RpcScreen
      title="planResources"
      description="Produces a query plan describing which resources of a kind the principal may perform an action on, for filtering lists without checking each item."
      defaultRequest={defaultRequest}
      run={planResources}
    />
  );
}
