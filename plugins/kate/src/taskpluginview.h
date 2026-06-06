#pragma once

#include <QObject>
#include <QPointer>
#include <QString>

namespace KTextEditor
{
class MainWindow;
class Plugin;
}

class QWidget;

/**
 * Per-main-window controller. Creates the two left-sidebar tool views (Tasks and
 * Calendar), each hosting a Kirigami QML scene inside a QQuickWidget.
 *
 * NOTE (Phase-1 spike): right now both tool views load the same SpikeView.qml.
 * The spike exists to prove the QQuickWidget-in-tool-view embedding before any
 * real model/UI is built on it — verify clean focus in/out, typing/IME, HiDPI
 * scaling, and render flush. See docs/planning/local-integration-design.md §3/§8.
 */
class TaskPluginView : public QObject
{
    Q_OBJECT

public:
    TaskPluginView(KTextEditor::Plugin *plugin, KTextEditor::MainWindow *mainWindow);
    ~TaskPluginView() override;

private:
    // Build a tool view whose content is a QQuickWidget loading the given QML resource.
    QWidget *createKirigamiToolView(KTextEditor::Plugin *plugin,
                                    const QString &identifier,
                                    const QString &iconName,
                                    const QString &title,
                                    const QString &qmlResource);

    KTextEditor::MainWindow *m_mainWindow;
    QPointer<QWidget> m_tasksToolView;
    QPointer<QWidget> m_calendarToolView;
};
