#include "taskapiclient.h"

#include <QDateTime>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRandomGenerator>
#include <QUrl>

namespace
{
// Crockford base32 ULID: 48-bit ms timestamp + 80 random bits, 26 chars.
QString generateUlid()
{
    static const char enc[] = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    char out[26];
    quint64 ts = static_cast<quint64>(QDateTime::currentMSecsSinceEpoch());
    for (int i = 9; i >= 0; --i) {
        out[i] = enc[ts & 0x1f];
        ts >>= 5;
    }
    for (int i = 10; i < 26; ++i)
        out[i] = enc[QRandomGenerator::global()->bounded(32)];
    return QString::fromLatin1(out, 26);
}

int httpStatus(QNetworkReply *reply)
{
    return reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
}
}

TaskApiClient::TaskApiClient(QObject *parent)
    : QObject(parent)
    , m_nam(new QNetworkAccessManager(this))
{
}

void TaskApiClient::setBaseUrl(const QString &baseUrl)
{
    m_baseUrl = baseUrl;
    while (m_baseUrl.endsWith(QLatin1Char('/')))
        m_baseUrl.chop(1); // never send the trailing slash (Phase-0 routing note)
}

void TaskApiClient::setCredential(const QString &userKey)
{
    m_key = userKey;
}

void TaskApiClient::setBoardId(const QString &boardId)
{
    m_boardId = boardId;
}

QNetworkRequest TaskApiClient::makeRequest(const QString &url, bool withIfMatch) const
{
    QNetworkRequest req((QUrl(url)));
    req.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    if (!m_key.isEmpty())
        req.setRawHeader("X-User-Key", m_key.toUtf8());
    if (withIfMatch && m_version > 0)
        req.setRawHeader("If-Match", QByteArray::number(m_version));
    return req;
}

void TaskApiClient::fetchTasks()
{
    Q_EMIT busyChanged(true);
    const QString url = m_baseUrl + QStringLiteral("/tasks?boardId=") + m_boardId;
    QNetworkReply *reply = m_nam->get(makeRequest(url, false));
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        Q_EMIT busyChanged(false);
        if (reply->error() != QNetworkReply::NoError) {
            Q_EMIT errorOccurred(reply->errorString());
            return;
        }
        const QJsonObject obj = QJsonDocument::fromJson(reply->readAll()).object();
        m_version = obj.value(QStringLiteral("version")).toInt(m_version);
        QVector<Task> tasks;
        const QJsonArray arr = obj.value(QStringLiteral("tasks")).toArray();
        tasks.reserve(arr.size());
        for (const QJsonValue &v : arr) {
            const QJsonObject o = v.toObject();
            Task t;
            t.id = o.value(QStringLiteral("id")).toString();
            t.title = o.value(QStringLiteral("title")).toString();
            t.tag = o.value(QStringLiteral("tag")).toString();
            t.state = o.value(QStringLiteral("state")).toString();
            t.createdAt = o.value(QStringLiteral("createdAt")).toString();
            t.startTime = o.value(QStringLiteral("startTime")).toString();
            t.endTime = o.value(QStringLiteral("endTime")).toString();
            tasks.push_back(t);
        }
        Q_EMIT tasksReceived(tasks, m_version);
    });
}

void TaskApiClient::handleConflictThenRefetch()
{
    Q_EMIT errorOccurred(QStringLiteral("Board changed elsewhere — refreshing."));
    fetchTasks();
}

void TaskApiClient::createTask(const QString &title, const QString &tag)
{
    const QString trimmed = title.trimmed();
    if (trimmed.isEmpty())
        return;
    QJsonObject body{
        {QStringLiteral("id"), generateUlid()},
        {QStringLiteral("title"), trimmed},
        {QStringLiteral("boardId"), m_boardId},
    };
    if (!tag.trimmed().isEmpty())
        body.insert(QStringLiteral("tag"), tag.trimmed());

    Q_EMIT busyChanged(true);
    QNetworkReply *reply =
        m_nam->post(makeRequest(m_baseUrl, true), QJsonDocument(body).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        Q_EMIT busyChanged(false);
        if (httpStatus(reply) == 409) {
            handleConflictThenRefetch();
            return;
        }
        if (reply->error() != QNetworkReply::NoError) {
            Q_EMIT errorOccurred(reply->errorString());
            return;
        }
        fetchTasks(); // resync list + version
    });
}

void TaskApiClient::completeTask(const QString &id)
{
    const QString url = m_baseUrl + QLatin1Char('/') + id + QStringLiteral("/complete?boardId=") + m_boardId;
    Q_EMIT busyChanged(true);
    QNetworkReply *reply = m_nam->post(makeRequest(url, true), QByteArray());
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        Q_EMIT busyChanged(false);
        const int status = httpStatus(reply);
        if (status == 409) {
            handleConflictThenRefetch();
            return;
        }
        // Treat 404 as success: the task is already gone (idempotent close).
        if (reply->error() != QNetworkReply::NoError && status != 404) {
            Q_EMIT errorOccurred(reply->errorString());
            return;
        }
        fetchTasks();
    });
}

void TaskApiClient::deleteTask(const QString &id)
{
    const QString url = m_baseUrl + QLatin1Char('/') + id + QStringLiteral("?boardId=") + m_boardId;
    Q_EMIT busyChanged(true);
    QNetworkReply *reply = m_nam->deleteResource(makeRequest(url, true));
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        Q_EMIT busyChanged(false);
        const int status = httpStatus(reply);
        if (status == 409) {
            handleConflictThenRefetch();
            return;
        }
        // Delete idempotency: 404 means it's already deleted — that's success.
        if (reply->error() != QNetworkReply::NoError && status != 404) {
            Q_EMIT errorOccurred(reply->errorString());
            return;
        }
        fetchTasks();
    });
}
