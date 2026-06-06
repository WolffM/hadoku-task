#pragma once

#include "domain.h"

#include <QObject>
#include <QString>
#include <QVector>

class QNetworkAccessManager;
class QNetworkReply;
class QNetworkRequest;

/**
 * Thin typed wrapper over the hadoku task REST API. Exposed to QML as `taskApi`.
 *
 * Auth (Phase 2): sends the raw user key as `X-User-Key` straight to
 * the hadoku.me task API — the edge-router validates it and stamps the worker.
 * (The session-id/KWallet cookie model from the design is a later refinement;
 * X-User-Key resolves to the same partition.)
 *
 * Concurrency: holds the board `version` from the last GET and sends it as
 * `If-Match` on writes; a 409 triggers a refetch (resync) rather than a clobber.
 */
class TaskApiClient : public QObject
{
    Q_OBJECT

public:
    explicit TaskApiClient(QObject *parent = nullptr);

    void setBaseUrl(const QString &baseUrl);
    void setCredential(const QString &userKey);
    void setBoardId(const QString &boardId);
    int version() const { return m_version; }

    // Invokable from QML.
    Q_INVOKABLE void fetchTasks();
    Q_INVOKABLE void createTask(const QString &title, const QString &tag = QString());
    Q_INVOKABLE void completeTask(const QString &id);
    Q_INVOKABLE void deleteTask(const QString &id);

Q_SIGNALS:
    void tasksReceived(const QVector<Task> &tasks, int version);
    void busyChanged(bool busy);
    void errorOccurred(const QString &message);

private:
    QNetworkRequest makeRequest(const QString &url, bool withIfMatch) const;
    void handleConflictThenRefetch();

    QNetworkAccessManager *m_nam;
    QString m_baseUrl = QStringLiteral("https://hadoku.me/task/api");
    QString m_key;
    QString m_boardId = QStringLiteral("main");
    int m_version = 0;
};
