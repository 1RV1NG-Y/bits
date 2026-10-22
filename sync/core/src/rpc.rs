//! The request surface shared by every front end (desktop helper, Android app).
//! Method names and JSON shapes are what the UI calls.

use anyhow::{Result, bail};
use serde::Deserialize;
use serde_json::Value;

use crate::{Node, NotePatch};

#[derive(Deserialize)]
struct UpdateParams {
    id: String,
    patch: NotePatch,
}

#[derive(Deserialize)]
struct TicketParams {
    ticket: String,
}

#[derive(Deserialize)]
struct IdParams {
    id: String,
}

pub async fn dispatch(node: &Node, method: &str, params: Value) -> Result<Value> {
    Ok(match method {
        "status" => serde_json::to_value(node.status())?,
        "notes" => serde_json::to_value(node.notes())?,
        "createNote" => serde_json::to_value(node.create_note(serde_json::from_value(params)?).await?)?,
        "updateNote" => {
            let p: UpdateParams = serde_json::from_value(params)?;
            serde_json::to_value(node.update_note(p.id, p.patch).await?)?
        }
        "createInvite" => serde_json::to_value(node.create_invite()?)?,
        "join" => {
            let p: TicketParams = serde_json::from_value(params)?;
            serde_json::to_value(node.use_code(&p.ticket).await?)?
        }
        "networkChanged" => {
            node.network_changed().await;
            Value::Null
        }
        "removeDevice" => {
            let p: IdParams = serde_json::from_value(params)?;
            node.remove_device(p.id).await?;
            Value::Null
        }
        other => bail!("unknown method {other}"),
    })
}
