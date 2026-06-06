#include "taskapiclient.h"

#include "logging.h"

#include <QDateTime>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRandomGenerator>
#include <QRegularExpression>
#include <QSet>
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

// Mirror of domain/utils/tags.ts extractTags: pull "#tag" tokens, normalise, join.
QString extractTags(const QString &text)
{
    static const QRegularExpression re(QStringLiteral("#[^\\s#]+"));
    QStringList tags;
    auto it = re.globalMatch(text);
    while (it.hasNext()) {
        QString tag = it.next().captured(0).mid(1).trimmed();
        tag.replace(QRegularExpression(QStringLiteral("\\s+")), QStringLiteral("-"));
        if (!tag.isEmpty())
            tags << tag;
    }
    return tags.join(QLatin1Char(' '));
}

// Mirror of parseTaskInput: split a quick-add string into title + tag.
void parseTaskInput(const QString &raw, QString &title, QString &tag)
{
    const QString input = raw.trimmed();
    static const QRegularExpression quoted(QStringLiteral("^[\"']([^\"']+)[\"']\\s*(.*)$"));
    static const QRegularExpression tagged(QStringLiteral("^(.+?)\\s+(#.+)$"));
    auto q = quoted.match(input);
    if (q.hasMatch()) {
        title = q.captured(1).trimmed();
        tag = extractTags(q.captured(2));
        return;
    }
    auto t = tagged.match(input);
    if (t.hasMatch()) {
        title = t.captured(1).trimmed();
        tag = extractTags(t.captured(2));
        return;
    }
    title = input;
    tag.clear();
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
        m_baseUrl.chop(1);
}

void TaskApiClient::setCredential(const QString &userKey)
{
    m_key = userKey;
    qCInfo(HadokuTask) << "TaskApiClient: credential set, length" << m_key.size()
                       << "(empty =" << m_key.isEmpty() << ")";
}

void TaskApiClient::logUi(const QString &message) const
{
    qCInfo(HadokuTask) << "[ui]" << message;
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

void TaskApiClient::recomputeTaskTags(const QVector<Task> &tasks)
{
    QSet<QString> set;
    for (const Task &t : tasks)
        for (const QString &one : t.tag.split(QLatin1Char(' '), Qt::SkipEmptyParts))
            set.insert(one);
    m_taskTags = QStringList(set.begin(), set.end());
}

void TaskApiClient::recomputeAllTags()
{
    QSet<QString> set;
    for (const QString &t : m_boardTags.value(m_boardId))
        set.insert(t);
    for (const QString &t : m_taskTags)
        set.insert(t);
    QStringList all(set.begin(), set.end());
    all.sort(Qt::CaseInsensitive);
    if (all != m_allTags) {
        m_allTags = all;
        Q_EMIT allTagsChanged();
    }
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------
void TaskApiClient::fetchBoards()
{
    const QString url = m_baseUrl + QStringLiteral("/boards");
    qCInfo(HadokuTask) << "GET" << url;
    QNetworkReply *reply = m_nam->get(makeRequest(url, false));
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        qCInfo(HadokuTask) << "GET /boards ->" << httpStatus(reply) << reply->errorString();
        if (reply->error() != QNetworkReply::NoError) {
            Q_EMIT errorOccurred(reply->errorString());
            return;
        }
        const QJsonObject obj = QJsonDocument::fromJson(reply->readAll()).object();
        m_boards.clear();
        m_boardTags.clear();
        const QJsonArray arr = obj.value(QStringLiteral("boards")).toArray();
        for (const QJsonValue &v : arr) {
            const QJsonObject o = v.toObject();
            const QString id = o.value(QStringLiteral("id")).toString();
            QVariantMap m;
            m.insert(QStringLiteral("id"), id);
            m.insert(QStringLiteral("name"), o.value(QStringLiteral("name")).toString(id));
            m_boards.push_back(m);
            QStringList tags;
            for (const QJsonValue &tg : o.value(QStringLiteral("tags")).toArray())
                tags << tg.toString();
            m_boardTags.insert(id, tags);
        }
        qCInfo(HadokuTask) << "GET /boards parsed" << m_boards.size() << "boards";
        Q_EMIT boardsChanged();
        recomputeAllTags();
    });
}

void TaskApiClient::switchBoard(const QString &boardId)
{
    if (boardId.isEmpty() || boardId == m_boardId)
        return;
    qCInfo(HadokuTask) << "switchBoard ->" << boardId;
    m_boardId = boardId;
    m_version = 0; // force a fresh version from the new board's GET
    Q_EMIT currentBoardIdChanged();
    recomputeAllTags();
    fetchTasks();
}

void TaskApiClient::createBoard(const QString &name)
{
    const QString trimmed = name.trimmed();
    if (trimmed.isEmpty())
        return;
    // Derive a slug id from the name.
    QString id = trimmed.toLower();
    id.replace(QRegularExpression(QStringLiteral("[^a-z0-9]+")), QStringLiteral("-"));
    id.remove(QRegularExpression(QStringLiteral("(^-+|-+$)")));
    if (id.isEmpty())
        id = generateUlid().toLower();
    QJsonObject body{{QStringLiteral("id"), id}, {QStringLiteral("name"), trimmed}};
    qCInfo(HadokuTask) << "POST /boards (create)" << id << trimmed;
    QNetworkReply *reply = m_nam->post(makeRequest(m_baseUrl + QStringLiteral("/boards"), false),
                                       QJsonDocument(body).toJson(QJsonDocument::Compact));
    connect(reply, &QNetworkReply::finished, this, [this, reply, id]() {
        reply->deleteLater();
        qCInfo(HadokuTask) << "POST /boards ->" << httpStatus(reply) << reply->errorString();
        if (reply->error() != QNetworkReply::NoError) {
            Q_EMIT errorOccurred(reply->errorString());
            return;
        }
        fetchBoards();
        switchBoard(id);
    });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
void TaskApiClient::fetchTasks()
{
    Q_EMIT busyChanged(true);
    const QString url = m_baseUrl + QStringLiteral("/tasks?boardId=") + m_boardId;
    qCInfo(HadokuTask) << "GET" << url;
    QNetworkReply *reply = m_nam->get(makeRequest(url, false));
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        Q_EMIT busyChanged(false);
        qCInfo(HadokuTask) << "GET /tasks ->" << httpStatus(reply)
                           << "err:" << reply->error() << reply->errorString();
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
        qCInfo(HadokuTask) << "GET /tasks parsed" << tasks.size() << "tasks, version" << m_version;
        m_tasks = tasks;
        recomputeTaskTags(tasks);
        recomputeAllTags();
        Q_EMIT tasksReceived(tasks, m_version);
    });
}

void TaskApiClient::reload()
{
    qCInfo(HadokuTask) << "reload(): re-syncing boards + tasks";
    fetchBoards();
    fetchTasks();
}

void TaskApiClient::changeKey(const QString &userKey)
{
    setCredential(userKey);
    m_version = 0; // new identity → forget the old board version
    reload();
}

// ---------------------------------------------------------------------------
// Write queue — serialize all mutations so rapid edits never race the board
// version (no 409), with optimistic local updates for instant feedback. The
// model reconciles with server truth via a single fetchTasks() when the queue
// drains.
// ---------------------------------------------------------------------------
int TaskApiClient::taskIndex(const QString &id) const
{
    for (int i = 0; i < m_tasks.size(); ++i)
        if (m_tasks.at(i).id == id)
            return i;
    return -1;
}

void TaskApiClient::optimisticEmit()
{
    recomputeTaskTags(m_tasks);
    recomputeAllTags();
    Q_EMIT tasksReceived(m_tasks, m_version);
}

void TaskApiClient::enqueueWrite(const QString &label, std::function<QNetworkReply *()> builder)
{
    m_writeQueue.append({label, std::move(builder)});
    if (!m_processing)
        runNextWrite();
}

void TaskApiClient::runNextWrite()
{
    if (m_writeQueue.isEmpty()) {
        m_processing = false;
        Q_EMIT busyChanged(false);
        fetchTasks(); // reconcile with authoritative tasks + version once
        return;
    }
    m_processing = true;
    Q_EMIT busyChanged(true);
    const PendingWrite item = m_writeQueue.takeFirst();
    QNetworkReply *reply = item.builder();
    if (!reply) {
        runNextWrite();
        return;
    }
    connect(reply, &QNetworkReply::finished, this, [this, reply, label = item.label]() {
        reply->deleteLater();
        const int status = httpStatus(reply);
        const QJsonObject obj = QJsonDocument::fromJson(reply->readAll()).object();
        if (status == 409) {
            // Shouldn't happen while serialized; resync from the server's version.
            m_version = obj.value(QStringLiteral("currentVersion")).toInt(0);
            qCWarning(HadokuTask) << label << "-> 409; resynced version to" << m_version;
        } else if (reply->error() != QNetworkReply::NoError && status != 404) {
            qCWarning(HadokuTask) << label << "failed:" << status << reply->errorString();
            Q_EMIT errorOccurred(reply->errorString());
        } else if (obj.contains(QStringLiteral("version"))) {
            m_version = obj.value(QStringLiteral("version")).toInt(m_version);
        } else {
            // No version in the response (e.g. batch ops) — drop the guard so the
            // next queued write doesn't present a stale If-Match.
            m_version = 0;
        }
        qCInfo(HadokuTask) << label << "->" << status << "version now" << m_version;
        runNextWrite();
    });
}

void TaskApiClient::createTask(const QString &input)
{
    QString title, tag;
    parseTaskInput(input, title, tag);
    if (title.isEmpty()) {
        qCWarning(HadokuTask) << "createTask: empty title, ignoring";
        return;
    }
    const QString id = generateUlid();
    // Optimistic: show the task immediately.
    Task t;
    t.id = id;
    t.title = title;
    t.tag = tag;
    t.state = QStringLiteral("Active");
    m_tasks.prepend(t);
    optimisticEmit();

    QJsonObject body{
        {QStringLiteral("id"), id},
        {QStringLiteral("title"), title},
        {QStringLiteral("boardId"), m_boardId},
    };
    if (!tag.isEmpty())
        body.insert(QStringLiteral("tag"), tag);
    enqueueWrite(QStringLiteral("create"), [this, body]() {
        return m_nam->post(makeRequest(m_baseUrl, true),
                           QJsonDocument(body).toJson(QJsonDocument::Compact));
    });
}

void TaskApiClient::setTaskTags(const QString &id, const QString &spaceSeparatedTags)
{
    const QString cleaned = spaceSeparatedTags.simplified();
    const int i = taskIndex(id);
    if (i >= 0) {
        m_tasks[i].tag = cleaned;
        optimisticEmit();
    }
    QJsonObject body{{QStringLiteral("boardId"), m_boardId}, {QStringLiteral("tag"), cleaned}};
    const QString url = m_baseUrl + QLatin1Char('/') + id;
    enqueueWrite(QStringLiteral("patch-tag"), [this, url, body]() {
        return m_nam->sendCustomRequest(makeRequest(url, true), "PATCH",
                                        QJsonDocument(body).toJson(QJsonDocument::Compact));
    });
}

void TaskApiClient::addTaskTag(const QString &id, const QString &tag)
{
    const int i = taskIndex(id);
    if (i < 0 || tag.trimmed().isEmpty())
        return;
    QStringList arr = m_tasks.at(i).tag.split(QLatin1Char(' '), Qt::SkipEmptyParts);
    if (arr.contains(tag))
        return;
    arr.append(tag);
    setTaskTags(id, arr.join(QLatin1Char(' ')));
}

void TaskApiClient::removeTaskTag(const QString &id, const QString &tag)
{
    const int i = taskIndex(id);
    if (i < 0)
        return;
    QStringList arr = m_tasks.at(i).tag.split(QLatin1Char(' '), Qt::SkipEmptyParts);
    if (arr.removeAll(tag) == 0)
        return; // task didn't have it
    setTaskTags(id, arr.join(QLatin1Char(' ')));
}

void TaskApiClient::clearTagEverywhere(const QString &tag)
{
    QJsonArray ids;
    for (int i = 0; i < m_tasks.size(); ++i) {
        QStringList arr = m_tasks[i].tag.split(QLatin1Char(' '), Qt::SkipEmptyParts);
        if (arr.removeAll(tag) > 0) {
            ids.append(m_tasks[i].id);
            m_tasks[i].tag = arr.join(QLatin1Char(' ')); // optimistic strip
        }
    }
    optimisticEmit();
    QJsonObject body{
        {QStringLiteral("boardId"), m_boardId},
        {QStringLiteral("tag"), tag},
        {QStringLiteral("taskIds"), ids},
    };
    const QString url = m_baseUrl + QStringLiteral("/batch-clear-tag");
    enqueueWrite(QStringLiteral("batch-clear-tag"), [this, url, body]() {
        return m_nam->post(makeRequest(url, false),
                           QJsonDocument(body).toJson(QJsonDocument::Compact));
    });
}

void TaskApiClient::completeTask(const QString &id)
{
    const int i = taskIndex(id);
    if (i >= 0) {
        m_tasks.removeAt(i); // optimistic: drop from the active list
        optimisticEmit();
    }
    const QString url =
        m_baseUrl + QLatin1Char('/') + id + QStringLiteral("/complete?boardId=") + m_boardId;
    enqueueWrite(QStringLiteral("complete"), [this, url]() {
        return m_nam->post(makeRequest(url, true), QByteArray());
    });
}

void TaskApiClient::deleteTask(const QString &id)
{
    const int i = taskIndex(id);
    if (i >= 0) {
        m_tasks.removeAt(i); // optimistic
        optimisticEmit();
    }
    const QString url = m_baseUrl + QLatin1Char('/') + id + QStringLiteral("?boardId=") + m_boardId;
    enqueueWrite(QStringLiteral("delete"), [this, url]() {
        return m_nam->deleteResource(makeRequest(url, true));
    });
}
