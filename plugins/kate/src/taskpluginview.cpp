#include "taskpluginview.h"

#include "logging.h"
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
#include <QTimer>
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

    qCInfo(HadokuTask) << "TaskPluginView: constructing";

    // Wire API → model.
    connect(m_api, &TaskApiClient::tasksReceived, m_store,
            [this](const QVector<Task> &tasks, int version) {
                qCInfo(HadokuTask) << "model updated:" << tasks.size() << "tasks, version" << version;
                m_store->setTasks(tasks);
            });
    connect(m_api, &TaskApiClient::errorOccurred, this,
            [](const QString &msg) { qCWarning(HadokuTask) << "API error:" << msg; });
    m_api->setCredential(m_session->userKey());

    // --- Tasks tab: live list -------------------------------------------------
    QQuickWidget *tasksView = createQuickToolView(plugin,
                                                  QStringLiteral("hadoku_tasks"),
                                                  QStringLiteral("view-task"),
                                                  i18n("Tasks"),
                                                  m_tasksToolView);
    tasksView->engine()->rootContext()->setContextProperty(QStringLiteral("taskStore"), m_store);
    tasksView->engine()->rootContext()->setContextProperty(QStringLiteral("taskApi"), m_api);
    tasksView->engine()->rootContext()->setContextProperty(QStringLiteral("session"), m_session);
    tasksView->setSource(QUrl(QStringLiteral("qrc:/qml/TasksToolView.qml")));

    // --- Calendar tab: agenda of scheduled tasks ------------------------------
    QQuickWidget *calendarView = createQuickToolView(plugin,
                                                     QStringLiteral("hadoku_calendar"),
                                                     QStringLiteral("view-calendar"),
                                                     i18n("Calendar"),
                                                     m_calendarToolView);
    calendarView->engine()->rootContext()->setContextProperty(QStringLiteral("taskApi"), m_api);
    calendarView->setSource(QUrl(QStringLiteral("qrc:/qml/CalendarToolView.qml")));

    // Initial load.
    m_api->fetchBoards();
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

    // Kate's createToolView() returns a widget that ALREADY has a layout. Creating
    // a second QVBoxLayout here is silently rejected by Qt, which leaves the
    // QQuickWidget orphaned at its size hint (it never fills the panel). Add to the
    // existing layout instead; only create one if Kate ever stops providing it.
    QLayout *layout = toolView->layout();
    if (!layout) {
        auto *vbox = new QVBoxLayout(toolView);
        vbox->setContentsMargins(0, 0, 0, 0);
        layout = vbox;
    }
    layout->setContentsMargins(0, 0, 0, 0);

    auto *quickWidget = new QQuickWidget(toolView);
    quickWidget->setResizeMode(QQuickWidget::SizeRootObjectToView);
    quickWidget->setAttribute(Qt::WA_AlwaysStackOnTop);
    quickWidget->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Expanding);
    // StrongFocus: without it the embedded Qt Quick scene never receives keyboard
    // input from Kate's widget world (clicks work, typing doesn't). This is the
    // classic QQuickWidget focus caveat the Phase-1 spike flagged.
    quickWidget->setFocusPolicy(Qt::StrongFocus);
    // Make i18n() available to the QML; must precede setSource (done by caller).
    KLocalization::setupLocalizedContext(quickWidget->engine());

    layout->addWidget(quickWidget);
    qCInfo(HadokuTask) << "tool view created:" << identifier
                       << "quickWidget sizeHint" << quickWidget->sizeHint();
    // Log the size Kate actually hands the tool view + embedded widget once the
    // sidebar has laid out, so we can see whether Kate expands it.
    QTimer::singleShot(2500, this, [toolView, quickWidget, identifier]() {
        if (toolView && quickWidget)
            qCInfo(HadokuTask) << "post-layout size" << identifier
                               << "toolView" << toolView->size()
                               << "quickWidget" << quickWidget->size();
    });
    return quickWidget;
}
