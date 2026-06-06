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
class QQuickWidget;
class TaskStore;
class TaskApiClient;
class SessionManager;

/**
 * Per-main-window controller. Creates the two left-sidebar tool views:
 *   - Tasks    — live Kirigami list backed by TaskStore + TaskApiClient.
 *   - Calendar — placeholder (SpikeView) until Phase 3.
 *
 * QML embedding uses QQuickWidget (spike-confirmed). i18n() needs a localized
 * context installed before setSource — see createQuickToolView().
 */
class TaskPluginView : public QObject
{
    Q_OBJECT

public:
    TaskPluginView(KTextEditor::Plugin *plugin, KTextEditor::MainWindow *mainWindow);
    ~TaskPluginView() override;

private:
    // Build a tool view hosting a QQuickWidget; returns the widget so the caller
    // can set context properties before loading QML. outToolView receives the
    // owning tool-view widget (so it can be deleted on unload).
    QQuickWidget *createQuickToolView(KTextEditor::Plugin *plugin,
                                      const QString &identifier,
                                      const QString &iconName,
                                      const QString &title,
                                      QPointer<QWidget> &outToolView);

    KTextEditor::MainWindow *m_mainWindow;
    SessionManager *m_session;
    TaskApiClient *m_api;
    TaskStore *m_store;
    QPointer<QWidget> m_tasksToolView;
    QPointer<QWidget> m_calendarToolView;
};
