#include "taskpluginview.h"

#include "sessionmanager.h"
#include "taskapiclient.h"
#include "taskstore.h"

#include <KTextEditor/MainWindow>
#include <KTextEditor/Plugin>

#include <KLocalizedQmlContext>
#include <KLocalizedString>

#include <QIcon>
#include <QQmlContext>
#include <QQmlEngine>
#include <QQuickStyle>
#include <QQuickWidget>
#include <QUrl>
#include <QVBoxLayout>
#include <QWidget>

TaskPluginView::TaskPluginView(KTextEditor::Plugin *plugin, KTextEditor::MainWindow *mainWindow)
    : QObject(plugin)
    , m_mainWindow(mainWindow)
    , m_session(new SessionManager(this))
    , m_api(new TaskApiClient(this))
    , m_store(new TaskStore(this))
{
    // Pin the Qt Quick Controls style so the embedded scene matches Kate's chrome.
    QQuickStyle::setStyle(QStringLiteral("org.kde.desktop"));

    // Wire API → model.
    connect(m_api, &TaskApiClient::tasksReceived, m_store,
            [this](const QVector<Task> &tasks, int) { m_store->setTasks(tasks); });
    m_api->setCredential(m_session->userKey());

    // --- Tasks tab: live list -------------------------------------------------
    QQuickWidget *tasksView = createQuickToolView(plugin,
                                                  QStringLiteral("hadoku_tasks"),
                                                  QStringLiteral("view-task"),
                                                  i18n("Tasks"),
                                                  m_tasksToolView);
    tasksView->engine()->rootContext()->setContextProperty(QStringLiteral("taskStore"), m_store);
    tasksView->engine()->rootContext()->setContextProperty(QStringLiteral("taskApi"), m_api);
    tasksView->setSource(QUrl(QStringLiteral("qrc:/qml/TasksToolView.qml")));

    // --- Calendar tab: placeholder until Phase 3 ------------------------------
    QQuickWidget *calendarView = createQuickToolView(plugin,
                                                     QStringLiteral("hadoku_calendar"),
                                                     QStringLiteral("view-calendar"),
                                                     i18n("Calendar"),
                                                     m_calendarToolView);
    calendarView->setSource(QUrl(QStringLiteral("qrc:/qml/SpikeView.qml")));

    // Initial load.
    m_api->fetchTasks();
}

TaskPluginView::~TaskPluginView()
{
    delete m_tasksToolView;
    delete m_calendarToolView;
}

QQuickWidget *TaskPluginView::createQuickToolView(KTextEditor::Plugin *plugin,
                                                  const QString &identifier,
                                                  const QString &iconName,
                                                  const QString &title,
                                                  QPointer<QWidget> &outToolView)
{
    QWidget *toolView = m_mainWindow->createToolView(plugin,
                                                     identifier,
                                                     KTextEditor::MainWindow::Left,
                                                     QIcon::fromTheme(iconName),
                                                     title);
    outToolView = toolView;

    auto *layout = new QVBoxLayout(toolView);
    layout->setContentsMargins(0, 0, 0, 0);

    auto *quickWidget = new QQuickWidget(toolView);
    quickWidget->setResizeMode(QQuickWidget::SizeRootObjectToView);
    quickWidget->setAttribute(Qt::WA_AlwaysStackOnTop);
    // Make i18n() available to the QML; must precede setSource (done by caller).
    KLocalization::setupLocalizedContext(quickWidget->engine());

    layout->addWidget(quickWidget);
    return quickWidget;
}
