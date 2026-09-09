import { render, screen } from "@testing-library/react-native";

import { ThemedText } from "../ThemedText";

it("renders its children", async () => {
  await render(<ThemedText>Hello Cerbos!</ThemedText>);

  expect(screen.getByText("Hello Cerbos!")).toBeTruthy();
});
