import SelectDropdown from "react-native-select-dropdown";
import { ThemedView } from "./ThemedView";
import { principals } from "@/constants/data";
import type { Principal } from "@cerbos/core";
import { ThemedText } from "./ThemedText";
import { StyleSheet } from "react-native";

interface PrincipalPickerProps {
  principal: Principal;
  setPrincipal: (principal: Principal) => void;
}

export function PrincipalPicker({
  principal,
  setPrincipal,
}: PrincipalPickerProps) {
  return (
    <ThemedView style={styles.dropdownColumn}>
      <ThemedText>Principal</ThemedText>
      <SelectDropdown
        data={principals.map((p) => ({ title: p.id, value: p }))}
        defaultValue={{ title: principal.id, value: principal }}
        onSelect={(selectedItem) => setPrincipal(selectedItem.value)}
        renderButton={(selectedItem) => (
          <ThemedView style={styles.dropdownButtonStyle}>
            <ThemedText style={styles.dropdownButtonTxtStyle}>
              {(selectedItem && selectedItem.title) || "Select principal"}
            </ThemedText>
          </ThemedView>
        )}
        renderItem={(item, _, isSelected) => (
          <ThemedView
            style={{
              ...styles.dropdownItemStyle,
              ...(isSelected && { backgroundColor: "#D2D9DF" }),
            }}
          >
            <ThemedText style={styles.dropdownItemTxtStyle}>
              {item.title}
            </ThemedText>
          </ThemedView>
        )}
        showsVerticalScrollIndicator={false}
        dropdownStyle={styles.dropdownMenuStyle}
      />
      <ThemedText style={styles.jsonText}>
        {JSON.stringify(principal, null, 2)}
      </ThemedText>
    </ThemedView>
  );
}

// Styles for the component
const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: "row",
    gap: 8,
    padding: 16,
  },
  dropdownContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
  },
  dropdownColumn: {
    flex: 1,
    flexDirection: "column",
  },
  dropdownButtonStyle: {
    width: 175,
    height: 50,
    backgroundColor: "#E9ECEF",
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  dropdownButtonTxtStyle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "500",
    color: "#151E26",
  },
  dropdownMenuStyle: {
    backgroundColor: "#E9ECEF",
    borderRadius: 8,
  },
  dropdownItemStyle: {
    width: "100%",
    flexDirection: "row",
    paddingHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 8,
  },
  dropdownItemTxtStyle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "500",
    color: "#151E26",
  },
  jsonText: {
    fontSize: 12,
    lineHeight: 16,
    padding: 8,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  allowedText: {
    color: "#43A047",
  },
  deniedText: {
    color: "#E53935",
  },
  timestampText: {
    fontSize: 12,
    textAlign: "center",
  },
});
