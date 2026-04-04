import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import * as Sentry from "@sentry/react-native";
import { COLORS } from "@/constants/colors";
import i18n from "@/i18n";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Root error boundary — catches unhandled JS errors, reports to Sentry,
 * and shows a recovery screen instead of a white screen crash.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack ?? "" } },
    });
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: COLORS.bg,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 32,
          }}
        >
          <Text style={{ fontSize: 48, marginBottom: 16 }}>😵</Text>
          <Text
            style={{
              color: COLORS.white,
              fontSize: 20,
              fontWeight: "bold",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            {i18n.t("common.somethingWentWrong")}
          </Text>
          <Text
            style={{
              color: COLORS.muted,
              fontSize: 14,
              textAlign: "center",
              marginBottom: 24,
              lineHeight: 20,
            }}
          >
            {i18n.t("common.unexpectedError")}
          </Text>
          <TouchableOpacity
            onPress={this.handleReset}
            style={{
              backgroundColor: COLORS.primary,
              paddingVertical: 14,
              paddingHorizontal: 32,
              borderRadius: 16,
            }}
          >
            <Text style={{ color: COLORS.white, fontSize: 16, fontWeight: "600" }}>
              {i18n.t("common.tryAgain")}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}
