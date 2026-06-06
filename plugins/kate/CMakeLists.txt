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
    Core Gui Widgets Qml Quick QuickWidgets Network)
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

target_link_libraries(katehadokutask PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::Qml
    Qt6::Quick
    Qt6::QuickWidgets
    Qt6::Network
    KF6::TextEditor
    KF6::CoreAddons
    KF6::I18n
    KF6::XmlGui
    KF6::Wallet
)

# KTextEditor discovers plugins under <plugin-dir>/kf6/ktexteditor/.
# KDE_INSTALL_PLUGINDIR resolves to the correct multiarch Qt6 plugin dir
# (e.g. /usr/lib/x86_64-linux-gnu/qt6/plugins on Debian, ~/.local/... for --prefix=$HOME/.local).
install(TARGETS katehadokutask DESTINATION ${KDE_INSTALL_PLUGINDIR}/kf6/ktexteditor)

feature_summary(WHAT ALL FATAL_ON_MISSING_REQUIRED_PACKAGES)
