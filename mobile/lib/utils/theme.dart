// EdgeVision — کلاینت موبایل
// Copyright © 2026 Parsa Fathi — Apache-2.0

import 'package:flutter/material.dart';

/// سیستم رنگ تیرهٔ EdgeVision — پس‌زمینهٔ 0xFF101214 با تک‌رنگ تأکیدی فیروزه‌ای.
///
/// قاعده: بدون آبی/نیلی، بدون گرادیان — فقط سطوح تخت خاکستری-تیره و
/// یک رنگ تأکیدی 0xFF2AA198.
abstract final class EvColors {
  /// پس‌زمینهٔ اصلی برنامه.
  static const Color background = Color(0xFF101214);

  /// سطح کارت‌ها و پنل‌ها.
  static const Color surface = Color(0xFF16191C);

  /// سطح ثانویه (ورودی‌ها، نوارها).
  static const Color surfaceAlt = Color(0xFF1C2024);

  /// خط مرزی و جداکننده‌ها.
  static const Color outline = Color(0xFF262B2F);

  /// رنگ تأکیدی تک — فیروزه‌ای.
  static const Color accent = Color(0xFF2AA198);

  /// متن با بیشترین تضاد.
  static const Color textHigh = Color(0xFFEDEEF0);

  /// متن با تضاد متوسط.
  static const Color textMedium = Color(0xFF9BA3AB);

  /// متن کم‌تضاد (زیرنویس‌ها).
  static const Color textLow = Color(0xFF5E666F);

  /// وضعیت سالم/موفق (سبز ملایم هم‌خانوادهٔ فیروزه‌ای).
  static const Color ok = Color(0xFF33A98C);

  /// هشدار.
  static const Color warn = Color(0xFFC9A227);

  /// خطا/خطر.
  static const Color danger = Color(0xFFC0564B);

  /// رنگ اشیای صحنه (هم‌خانوادهٔ پالت).
  static const Color objectVehicle = Color(0xFF8E949C);
  static const Color objectPedestrian = Color(0xFFE0C568);
  static const Color objectCyclist = Color(0xFF5EEAD4);

  /// جعبهٔ تشخیص (تأکید).
  static const Color detectionBox = accent;

  /// ناحیهٔ پایش (ROI).
  static const Color roi = warn;

  /// خط عبور.
  static const Color line = Color(0xFF5EEAD4);
}

/// ساخت تم تیرهٔ برنامه (Material 3، فارسی، راست‌به‌چپ).
ThemeData buildEvTheme() {
  const scheme = ColorScheme.dark(
    primary: EvColors.accent,
    onPrimary: Color(0xFF04110F),
    secondary: EvColors.accent,
    onSecondary: Color(0xFF04110F),
    surface: EvColors.surface,
    onSurface: EvColors.textHigh,
    surfaceContainerHighest: EvColors.surfaceAlt,
    onSurfaceVariant: EvColors.textMedium,
    error: EvColors.danger,
    onError: Color(0xFF1A0908),
    outline: EvColors.outline,
    outlineVariant: EvColors.outline,
  );

  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: scheme,
    scaffoldBackgroundColor: EvColors.background,
    fontFamily: null,
    splashFactory: InkRipple.splashFactory,
  );

  return base.copyWith(
    appBarTheme: const AppBarTheme(
      backgroundColor: EvColors.background,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        color: EvColors.textHigh,
        fontSize: 18,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      ),
      iconTheme: IconThemeData(color: EvColors.textHigh),
    ),
    navigationBarTheme: const NavigationBarThemeData(
      backgroundColor: EvColors.surface,
      indicatorColor: EvColors.surfaceAlt,
      height: 64,
      labelTextStyle: WidgetStatePropertyAll<TextStyle>(
        TextStyle(
          color: EvColors.textMedium,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
      iconTheme: WidgetStatePropertyAll<IconThemeData>(
        IconThemeData(color: EvColors.textMedium),
      ),
    ),
    cardTheme: const CardThemeData(
      color: EvColors.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(14)),
        side: BorderSide(color: EvColors.outline),
      ),
    ),
    dividerTheme: const DividerThemeData(
      color: EvColors.outline,
      thickness: 1,
      space: 1,
    ),
    listTileTheme: const ListTileThemeData(
      iconColor: EvColors.textMedium,
      titleTextStyle: TextStyle(
        color: EvColors.textHigh,
        fontSize: 14,
        fontWeight: FontWeight.w600,
      ),
      subtitleTextStyle: TextStyle(
        color: EvColors.textMedium,
        fontSize: 12,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: EvColors.surfaceAlt,
      hintStyle: const TextStyle(color: EvColors.textLow),
      labelStyle: const TextStyle(color: EvColors.textMedium),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: EvColors.outline),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: EvColors.outline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: EvColors.accent, width: 1.4),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: EvColors.danger),
      ),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: 12,
        vertical: 10,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: EvColors.accent,
        foregroundColor: const Color(0xFF04110F),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: EvColors.textHigh,
        side: const BorderSide(color: EvColors.outline),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: EvColors.accent,
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: EvColors.surfaceAlt,
      side: const BorderSide(color: EvColors.outline),
      labelStyle: const TextStyle(color: EvColors.textMedium, fontSize: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    ),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: EvColors.surfaceAlt,
      contentTextStyle: TextStyle(color: EvColors.textHigh, fontSize: 13),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(10)),
        side: BorderSide(color: EvColors.outline),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: EvColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: EvColors.outline),
      ),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: EvColors.surfaceAlt,
      textStyle: const TextStyle(color: EvColors.textHigh, fontSize: 13),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: EvColors.accent,
      linearTrackColor: EvColors.surfaceAlt,
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith<Color?>(
        (states) => states.contains(WidgetState.selected)
            ? EvColors.accent
            : EvColors.textLow,
      ),
      trackColor: WidgetStateProperty.resolveWith<Color?>(
        (states) => states.contains(WidgetState.selected)
            ? const Color(0xFF173A36)
            : EvColors.surfaceAlt,
      ),
    ),
    sliderTheme: const SliderThemeData(
      activeTrackColor: EvColors.accent,
      inactiveTrackColor: EvColors.surfaceAlt,
      thumbColor: EvColors.accent,
      overlayColor: Color(0x1F2AA198),
    ),
    tabBarTheme: const TabBarThemeData(
      labelColor: EvColors.accent,
      unselectedLabelColor: EvColors.textMedium,
      indicatorColor: EvColors.accent,
      dividerColor: EvColors.outline,
    ),
  );
}
