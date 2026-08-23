use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Tag {
    #[serde(rename = "release")]
    Release,
    #[serde(rename = "guide")]
    Guide,
    #[serde(rename = "note")]
    Note,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Post {
    pub id: String,
    pub title: String,
    pub body: String,
    pub tag: Tag,
}

#[derive(Deserialize)]
pub struct CreatePostInput {
    pub title: String,
    pub body: String,
    pub tag: Tag,
}

#[derive(Deserialize)]
pub struct UpdatePostInput {
    pub id: String,
    pub title: String,
    pub body: String,
    pub tag: Tag,
}

#[derive(Serialize)]
pub struct DeletePostResult {
    pub id: String,
}

pub struct PostsStore {
    posts: Mutex<Vec<Post>>,
    next_id: Mutex<u32>,
}

impl PostsStore {
    pub fn new() -> Self {
        let posts = vec![
            Post {
                id: "1".into(),
                title: "Shipping the new dashboard".into(),
                body: "A walkthrough of the redesigned dashboard and why we rebuilt it around streaming data.".into(),
                tag: Tag::Release,
            },
            Post {
                id: "2".into(),
                title: "Type-safe routing with TanStack Router".into(),
                body: "How generated route trees and search-param schemas remove a whole class of bugs.".into(),
                tag: Tag::Guide,
            },
            Post {
                id: "3".into(),
                title: "Preloading on intent".into(),
                body: "Hovering a link now kicks off its loader before the click even lands.".into(),
                tag: Tag::Guide,
            },
            Post {
                id: "4".into(),
                title: "Office hours notes".into(),
                body: "Answers to the most common questions from this week's office hours.".into(),
                tag: Tag::Note,
            },
            Post {
                id: "5".into(),
                title: "Deprecating the legacy API".into(),
                body: "The v1 endpoints will be removed next quarter. Here's the migration path.".into(),
                tag: Tag::Release,
            },
        ];
        Self {
            posts: Mutex::new(posts),
            next_id: Mutex::new(6),
        }
    }
}

// Any write whose title/body contains "fail" rejects, so optimistic
// rollback can be exercised on demand without flaky randomness.
fn check_fail(fields: &[&str]) -> Result<(), String> {
    if fields.iter().any(|f| f.to_lowercase().contains("fail")) {
        return Err("The server rejected this write".into());
    }
    Ok(())
}

#[tauri::command]
pub fn fetch_posts(
    store: tauri::State<PostsStore>,
    q: Option<String>,
    tag: Option<Tag>,
) -> Vec<Post> {
    let posts = store.posts.lock().unwrap();
    posts
        .iter()
        .filter(|p| {
            let matches_q = q
                .as_ref()
                .map_or(true, |q| p.title.to_lowercase().contains(&q.to_lowercase()));
            let matches_tag = tag.map_or(true, |t| p.tag == t);
            matches_q && matches_tag
        })
        .cloned()
        .collect()
}

#[tauri::command]
pub fn fetch_post(store: tauri::State<PostsStore>, id: String) -> Result<Post, String> {
    store
        .posts
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or_else(|| format!("Post \"{id}\" was not found"))
}

#[tauri::command]
pub fn create_post(
    store: tauri::State<PostsStore>,
    input: CreatePostInput,
) -> Result<Post, String> {
    check_fail(&[&input.title, &input.body])?;
    let mut next_id = store.next_id.lock().unwrap();
    let id = next_id.to_string();
    *next_id += 1;
    let post = Post {
        id,
        title: input.title,
        body: input.body,
        tag: input.tag,
    };
    store.posts.lock().unwrap().insert(0, post.clone());
    Ok(post)
}

#[tauri::command]
pub fn update_post(
    store: tauri::State<PostsStore>,
    input: UpdatePostInput,
) -> Result<Post, String> {
    check_fail(&[&input.title, &input.body])?;
    let mut posts = store.posts.lock().unwrap();
    let existing = posts
        .iter_mut()
        .find(|p| p.id == input.id)
        .ok_or_else(|| format!("Post \"{}\" was not found", input.id))?;
    existing.title = input.title;
    existing.body = input.body;
    existing.tag = input.tag;
    Ok(existing.clone())
}

#[tauri::command]
pub fn delete_post(store: tauri::State<PostsStore>, id: String) -> DeletePostResult {
    store.posts.lock().unwrap().retain(|p| p.id != id);
    DeletePostResult { id }
}
