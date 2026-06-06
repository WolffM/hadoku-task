#include "logging.h"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QMutex>
#include <QStandardPaths>
#include <QTextStream>

Q_LOGGING_CATEGORY(HadokuTask, "hadoku.task")

namespace
{
QtMessageHandler g_previous = nullptr;
QString g_logPath;
QMutex g_mutex;

void messageHandler(QtMsgType type, const QMessageLogContext &ctx, const QString &msg)
{
    const QByteArray cat(ctx.category ? ctx.category : "");
    // Capture our own logs, plus QML/JS engine messages (white-screen errors land
    // here as "file.qml:line: ..." under the default/qml/js categories).
    const bool ours = cat.startsWith("hadoku.task");
    const bool qmlish = cat.startsWith("qml") || cat.startsWith("js")
                        || msg.contains(QLatin1String(".qml"));
    if ((ours || qmlish) && !g_logPath.isEmpty()) {
        QMutexLocker locker(&g_mutex);
        QFile f(g_logPath);
        if (f.open(QIODevice::Append | QIODevice::Text)) {
            const char *level = type == QtDebugMsg     ? "DBG"
                                : type == QtInfoMsg     ? "INF"
                                : type == QtWarningMsg  ? "WRN"
                                : type == QtCriticalMsg ? "CRT"
                                                        : "FTL";
            QTextStream(&f) << QDateTime::currentDateTime().toString(Qt::ISODateWithMs) << ' '
                            << level << ' ' << msg << '\n';
        }
    }
    if (g_previous)
        g_previous(type, ctx, msg);
}
}

void HadokuLog::install()
{
    QDir dir(QStandardPaths::writableLocation(QStandardPaths::GenericCacheLocation));
    dir.mkpath(QStringLiteral("hadoku-task"));
    g_logPath = dir.filePath(QStringLiteral("hadoku-task/plugin.log"));

    g_previous = qInstallMessageHandler(messageHandler);
    QLoggingCategory::setFilterRules(QStringLiteral("hadoku.task=true"));
}

QString HadokuLog::logFilePath()
{
    return g_logPath;
}
