cmake_minimum_required(VERSION 3.16)

project(katehadokutask VERSION 0.1.0 LANGUAGES CXX)

# --- Dependency versions (match the Debian 13 / KF6 toolchain) -----------------
set(QT_MIN_VERSION 6.5.0)
set(KF_MIN_VERSION 6.0.0)

find_package(ECM ${KF_MIN_VERSION} REQUIRED NO_MODULE)
set(CMAKE_MODULE_PATH ${ECM_MODULE_PATH})

include(KDEInstallDirs)
include(KDECMakeSettings)
include(KDECompilerSettings NO_POLICY_SCOPE)
include(FeatureSummary)

find_package(Qt6 ${QT_MIN_VERSION} REQUIRED COMPONENTS
    Core Gui Widgets Qml Quick QuickControls2 QuickWidgets Network)
# KF6::I18nQml is not a separate findable component — its target ships with the
# I18n package's targets file, so finding I18n makes KF6::I18nQml available to link.
find_package(KF6 ${KF_MIN_VERSION} REQUIRED COMPONENTS
    TextEditor CoreAddons I18n XmlGui Wallet)

set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# --- The plugin (a Qt plugin MODULE loaded by Kate's KTextEditor) --------------
add_library(katehadokutask MODULE)

target_sources(katehadokutask PRIVATE
    src/taskplugin.cpp
    src/taskpluginview.cpp
    resources.qrc
)

# setupLocalizedContext() picks this up to scope i18n() calls to our catalog
# (also silences KLocalizedString's "domain is not set" warning).
target_compile_definitions(katehadokutask PRIVATE TRANSLATION_DOMAIN="katehadokutask")

target_link_libraries(katehadokutask PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::Qml
    Qt6::Quick
    Qt6::QuickControls2
    Qt6::QuickWidgets
    Qt6::Network
    KF6::TextEditor
    KF6::CoreAddons
    KF6::I18n
    KF6::I18nQml
    KF6::XmlGui
    KF6::Wallet
)

# KTextEditor scans <qt-plugin-dir>/kf6/ktexteditor/. On Debian that dir carries
# a `qt6/` infix (/usr/lib/<arch>/qt6/plugins) which ECM's KDE_INSTALL_PLUGINDIR
# drops for non-Qt prefixes — so a --prefix=$HOME/.local install lands somewhere
# Qt never searches. Query qtpaths for the real, absolute plugin dir instead, so a
# plain `sudo cmake --install build` puts the .so exactly where Kate looks.
find_program(QTPATHS6 NAMES qtpaths6 qtpaths REQUIRED)
execute_process(
    COMMAND ${QTPATHS6} --plugin-dir
    OUTPUT_VARIABLE QT_PLUGIN_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE)
message(STATUS "Qt plugin dir: ${QT_PLUGIN_DIR}")
install(TARGETS katehadokutask DESTINATION "${QT_PLUGIN_DIR}/kf6/ktexteditor")

feature_summary(WHAT ALL FATAL_ON_MISSING_REQUIRED_PACKAGES)
