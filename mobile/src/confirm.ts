import { Alert, Platform } from "react-native";

export function confirmAsync(title: string, message: string, okLabel = "Yes", cancelLabel = "No"): Promise<boolean> {
  if (Platform.OS === "web") {
    const w: any = globalThis as any;
    return Promise.resolve(typeof w.confirm === "function" ? w.confirm(`${title}\n\n${message}`) : true);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
        { text: okLabel, style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}
